import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { decryptWorkspaceIntegration, encryptIntegrationCredential } from "@/lib/workspace-integrations"
import { googleAdsContext } from "@/lib/onboarding/google-ads-server"
import { portalGoogleAdsContext } from "@/lib/client-portal/google-ads-server"
import { runGoogleAdsConnection } from "./connection-server"
import { ADS_SCOPE, discoverAdsAccounts, oauthConnectionRunner, type AdsChoice } from "./oauth-provider"

export const OAUTH_ORIGIN = "https://app.betelgeze.com"
export const OAUTH_CALLBACK = `${OAUTH_ORIGIN}/api/google-ads/oauth/callback`
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const random = () => randomBytes(32).toString("base64url")
const pack = (value: unknown) => encryptIntegrationCredential({ payload: JSON.stringify(value) })
const unpack = <T>(value: string): T => JSON.parse(decryptWorkspaceIntegration(value).payload) as T
export const oauthEnabled = () => Boolean(process.env.GOOGLE_ADS_OAUTH_CLIENT_ID && process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET)
function config() {
    if (!oauthEnabled()) throw new Error("Google sign-in is not configured yet. Use your customer ID to connect.")
    return { id: process.env.GOOGLE_ADS_OAUTH_CLIENT_ID!, secret: process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET! }
}
type Source = { token: string; blockId?: string }
type Context = Source & { origin: string; verifier: string; integrationHash: string; clientHash: string; workspaceId: string; relationshipId: string }
type Attempt = { state_hash: string; browser_hash: string | null; phase: string; context_encrypted: string; credential_encrypted: string | null; choices: AdsChoice[]; limited: boolean; result: { status: string } | null; expires_at: string }
const invalid = () => new Error("This Google sign-in has expired or was replaced. Return to your portal or onboarding and start again.")
export function oauthCookieName(state: string) { return `__Host-be-ga-${state.slice(0, 16)}` }
function validState(state: string) { if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw invalid() }
async function sourceContext(source: Source) {
    if (source.blockId) {
        const { resolved, integration } = await googleAdsContext(source.token, source.blockId, true)
        return { integration, workspaceId: resolved.session.workspace_id, relationshipId: resolved.session.relationship_id, managerName: String(integration.config_hint?.manager_name || resolved.workspace.name), scope: { token: source.token, blockId: source.blockId } }
    }
    const { access, integration } = await portalGoogleAdsContext(source.token)
    if (!integration) throw new Error("Your agency needs to connect Google Ads first.")
    return { integration, workspaceId: access.workspace.id, relationshipId: access.relationship.id, managerName: String(integration.config_hint?.manager_name || access.workspace.name), scope: { token: source.token, workspaceId: access.workspace.id } }
}
async function authorizeContext(context: Context) {
    const current = await sourceContext(context), cfg = config()
    if (current.workspaceId !== context.workspaceId || current.relationshipId !== context.relationshipId || hash(current.integration.config_encrypted) !== context.integrationHash || hash(cfg.id + cfg.secret) !== context.clientHash) throw invalid()
    return current
}
export async function prepareOAuth(source: Source, origin: string) {
    const cfg = config(), current = await sourceContext(source), state = random()
    const url = new URL(origin)
    if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Start Google sign-in from your secure portal or onboarding page.")
    const context: Context = { ...source, origin, verifier: random(), integrationHash: hash(current.integration.config_encrypted), clientHash: hash(cfg.id + cfg.secret), workspaceId: current.workspaceId, relationshipId: current.relationshipId }
    const { error } = await supabaseAdmin.rpc("prepare_google_ads_oauth", { p_workspace: current.workspaceId, p_relationship: current.relationshipId, p_state_hash: hash(state), p_context: pack(context) })
    if (error) throw new Error(error.code === "P0001" ? error.message : "Google sign-in could not be started. Please retry.")
    return { url: `${OAUTH_ORIGIN}/api/google-ads/oauth/start?state=${state}` }
}
async function readAttempt(state: string, browser = true) {
    validState(state)
    const { data, error } = await supabaseAdmin.from("google_ads_oauth_attempts").select("state_hash,browser_hash,phase,context_encrypted,credential_encrypted,choices,limited,result,expires_at").eq("state_hash", hash(state)).gt("expires_at", new Date().toISOString()).maybeSingle()
    if (error || !data) throw invalid()
    const attempt = data as Attempt
    if (browser) {
        const value = (await cookies()).get(oauthCookieName(state))?.value
        if (!value || !attempt.browser_hash || !timingSafeEqual(Buffer.from(hash(value)), Buffer.from(attempt.browser_hash))) throw invalid()
    }
    return { attempt, context: unpack<Context>(attempt.context_encrypted) }
}
async function transition(attempt: Attempt, next: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.from("google_ads_oauth_attempts").update(next).eq("state_hash", attempt.state_hash).eq("phase", attempt.phase).gt("expires_at", new Date().toISOString()).select("state_hash").maybeSingle()
    if (error || !data) throw invalid()
}
export async function startOAuth(state: string) {
    const { attempt, context } = await readAttempt(state, false)
    if (attempt.phase !== "prepared") throw invalid()
    await authorizeContext(context)
    const browser = random(), cfg = config()
    await transition(attempt, { phase: "authorizing", browser_hash: hash(browser) })
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.search = new URLSearchParams({ client_id: cfg.id, redirect_uri: OAUTH_CALLBACK, response_type: "code", scope: ADS_SCOPE, state, access_type: "online", prompt: "select_account", code_challenge: createHash("sha256").update(context.verifier).digest("base64url"), code_challenge_method: "S256" }).toString()
    return { url: url.toString(), browser }
}
export async function callbackOAuth(state: string, code: string | null, denied: boolean) {
    const { attempt, context } = await readAttempt(state)
    if (attempt.phase !== "authorizing") throw invalid()
    await authorizeContext(context)
    await transition(attempt, { phase: "exchanging" })
    try {
        if (denied || !code || code.length > 4096) throw new Error("Google sign-in was not completed. Return to your portal or onboarding to retry.")
        const cfg = config(), budget = AbortSignal.timeout(45_000)
        const fetcher: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.any([budget, init?.signal ?? budget]) })
        const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, code, code_verifier: context.verifier, redirect_uri: OAUTH_CALLBACK, grant_type: "authorization_code" }) })
        const token = await response.json() as { access_token?: string; expires_in?: number; scope?: string }
        if (!response.ok || !token.access_token || (token.scope && !token.scope.split(" ").includes(ADS_SCOPE)) || Number(token.expires_in) < 600) throw new Error("Google sign-in could not be verified. Return to your portal or onboarding to retry.")
        const { choices, limited } = await discoverAdsAccounts(token.access_token, fetcher)
        await authorizeContext(context)
        await transition({ ...attempt, phase: "exchanging" }, { phase: "ready", credential_encrypted: pack({ token: token.access_token }), choices, limited })
    } catch (error) {
        await transition({ ...attempt, phase: "exchanging" }, { phase: "failed", credential_encrypted: null, choices: [] }).catch(() => {})
        throw error
    }
}
export async function viewOAuth(state: string) {
    const { attempt, context } = await readAttempt(state)
    const current = await authorizeContext(context)
    return { phase: attempt.phase, choices: attempt.choices.map(({ id, name }) => ({ id, name })), limited: attempt.limited, managerName: current?.managerName ?? "Your agency", status: attempt.result?.status ?? null, origin: context.origin }
}
export async function connectOAuth(state: string, customerId: string, consented: boolean) {
    const { attempt, context } = await readAttempt(state)
    if (attempt.phase !== "ready" || !consented || !attempt.credential_encrypted) throw invalid()
    const choice = attempt.choices.find(option => option.id === customerId)
    if (!choice) throw new Error("Choose an account returned by Google.")
    const current = await authorizeContext(context)
    await transition(attempt, { phase: "connecting" })
    try {
        const { token } = unpack<{ token: string }>(attempt.credential_encrypted)
        const connection = await runGoogleAdsConnection(current.integration, current.scope, customerId, true, oauthConnectionRunner(token, choice))
        await transition({ ...attempt, phase: "connecting" }, { phase: "done", credential_encrypted: null, choices: [], result: { status: connection.status } })
        return { status: connection.status, origin: context.origin }
    } catch (error) {
        await transition({ ...attempt, phase: "connecting" }, { phase: "failed", credential_encrypted: null, choices: [] }).catch(() => {})
        throw error
    }
}
