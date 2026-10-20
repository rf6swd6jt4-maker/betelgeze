import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { decryptWorkspaceIntegration, encryptIntegrationCredential } from "@/lib/workspace-integrations"
import { fetchGhlCalendars, type GhlCalendarChoice } from "@/lib/client-portal/ghl-calendar-list-provider"
import { fetchGhlCalendar } from "@/lib/client-portal/ghl-calendar-provider"
import { fetchGhlMetrics } from "@/lib/client-portal/ghl-provider"
import { exchangeGhlCode, ghlAuthorizationUrl, ghlLocationToken, listGhlInstalledLocations, refreshGhlToken, GhlOAuthError, GHL_OAUTH_CALLBACK, type GhlOAuthConfig, type GhlOAuthLocation, type GhlOAuthToken } from "./provider"

const COOKIE = "__Host-be-ghl-connect"
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const opaque = /^[A-Za-z0-9_-]{43}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const safeMessages: Record<string, string> = {
    access: "You no longer have access to this client connection.",
    changed: "This connection changed. Reload Client Connections and start again.",
    expired: "This connection attempt expired. Start again from Client Connections.",
    phase: "This step has already been used. Return to Client Connections to continue or start again.",
    duplicate: "This sub-account is already connected to another client. Retire that connection first.",
    duplicate_archived: "This sub-account belongs to an archived connection. Retire that connection first.",
    retire_required: "Retire the current connection before choosing a different sub-account.",
    busy: "This client connection is being updated. Please try again shortly.",
    portal: "These approved appointment templates require the verified portal.scaylup.com client portal.",
    oauth: "Reconnect the HighLevel app before enabling appointment notifications.",
    profile: "Finish connecting the calendar before enabling appointment notifications.",
    consent: "This client needs an active, confirmed WhatsApp number before notifications can be enabled.",
    portal_session: "This client needs an active client portal before notifications can be enabled.",
    preflight: "The notification checks expired. Please try enabling notifications again.",
}
export class GhlConnectionError extends Error {}
const unavailable = () => new GhlConnectionError("The HighLevel connection could not be completed. Start again from Client Connections.")
const selectionSteps = {
    saved_authorization: "BE could not read the saved HighLevel authorisation. Start a new connection attempt.",
    installed_accounts: "BE could not verify the selected HighLevel sub-account. Your existing calendar connection is unchanged.",
    location_token: "HighLevel did not provide usable access to the selected sub-account. Start a new connection attempt.",
    calendar_list: "BE could not load this sub-account’s calendars. Your existing calendar connection is unchanged.",
} as const
function selectionFailure(step: keyof typeof selectionSteps, error: unknown) {
    const code = error instanceof GhlOAuthError ? error.code : "unexpected"
    const status = error instanceof GhlOAuthError ? error.status : undefined
    // Only fixed labels and the HTTP status: never log tokens, provider bodies,
    // callback URLs, record identifiers or arbitrary error messages/stacks.
    console.error("ghl_connection_step_failed", { step, code, ...(status ? { status } : {}) })
    return new GhlConnectionError(`${selectionSteps[step]} Reference: ${step}/${code}${status ? `/${status}` : ""}.`)
}

type Attempt = { state_hash: string; workspace_id: string; workspace_slug: string; relationship_id: string; user_id: string; phase: string; credential_encrypted: string | null; choices: GhlOAuthLocation[]; limited: boolean; selected_location: string | null }
type SavedGrant = { token: GhlOAuthToken; calendars?: GhlCalendarChoice[] }
function encrypt(grant: SavedGrant) { return encryptIntegrationCredential({ payload: JSON.stringify(grant) }) }
function decrypt(value: string | null): SavedGrant {
    if (!value) throw unavailable()
    return JSON.parse(decryptWorkspaceIntegration(value).payload) as SavedGrant
}
export function ghlOAuthConfig(): GhlOAuthConfig {
    const config = { clientId: process.env.GHL_OAUTH_CLIENT_ID?.trim() ?? "", clientSecret: process.env.GHL_OAUTH_CLIENT_SECRET?.trim() ?? "", appId: process.env.GHL_OAUTH_APP_ID?.trim() ?? "", installUrl: process.env.GHL_OAUTH_INSTALL_URL?.trim() ?? "" }
    if (process.env.GHL_OAUTH_ENABLED !== "true" || !config.clientId || !config.clientSecret || !config.appId || !config.installUrl) throw new GhlConnectionError("The HighLevel app connection is not available yet.")
    ghlAuthorizationUrl(config, "a".repeat(43))
    return config
}
function configHash(config: GhlOAuthConfig) { return hash(JSON.stringify(config)) }
async function rpc(action: string, input: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc("ghl_oauth_connection", { p_action: action, p_input: input })
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw unavailable()
    if (data.failure) throw new GhlConnectionError(safeMessages[String(data.failure)] ?? unavailable().message)
    return data as Record<string, unknown>
}
async function binding(config: GhlOAuthConfig, callbackState?: string) {
    const cookie = (await cookies()).get(COOKIE)?.value ?? ""
    const [state, browser, extra] = cookie.split(".")
    if (!opaque.test(state ?? "") || !opaque.test(browser ?? "") || extra != null) throw new GhlConnectionError(safeMessages.expired)
    if (callbackState != null && (!opaque.test(callbackState) || !timingSafeEqual(Buffer.from(state), Buffer.from(callbackState)))) throw new GhlConnectionError(safeMessages.expired)
    return { stateHash: hash(state), browserHash: hash(browser), configHash: configHash(config) }
}
async function context(workspaceSlug?: string, callbackState?: string) {
    const config = ghlOAuthConfig(), keys = await binding(config, callbackState)
    const attempt = await rpc("read", keys) as unknown as Attempt
    if (workspaceSlug && workspaceSlug !== attempt.workspace_slug) throw new GhlConnectionError(safeMessages.access)
    const { workspace, user } = await requireWorkspacePanel(attempt.workspace_slug, "client-connections")
    if (workspace.id !== attempt.workspace_id || user.id !== attempt.user_id) throw new GhlConnectionError(safeMessages.access)
    return { config, keys: { ...keys, userId: user.id }, attempt }
}

export async function startGhlConnection(workspaceSlug: string, input: Record<string, unknown>) {
    const config = ghlOAuthConfig()
    if (typeof input.relationshipId !== "string" || !uuid.test(input.relationshipId) || (input.expectedRevision !== null && (typeof input.expectedRevision !== "string" || !uuid.test(input.expectedRevision)))) throw unavailable()
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
    const state = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url")
    await rpc("prepare", { stateHash: hash(state), browserHash: hash(browser), configHash: configHash(config), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: user.id, relationshipId: input.relationshipId, expectedRevision: input.expectedRevision })
    ;(await cookies()).set(COOKIE, `${state}.${browser}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 20 * 60 })
    return { authorizationUrl: ghlAuthorizationUrl(config, state) }
}

export async function completeGhlAuthorization(state: string, code: string | null, denied: boolean) {
    const { config, keys, attempt } = await context(undefined, state)
    const destination = new URL(`/${encodeURIComponent(attempt.workspace_slug)}/client-connections`, GHL_OAUTH_CALLBACK)
    // A browser retry must never redeem a single-use authorization code twice.
    if (["ready", "selected", "done"].includes(attempt.phase)) { destination.searchParams.set("ghl", attempt.phase); return destination }
    if (denied || !code) {
        await rpc("transition", { ...keys, from: "authorizing", to: "failed" })
        destination.searchParams.set("ghl", "failed")
        return destination
    }
    // Only the callback which owns this transition may mark its exchange failed.
    await rpc("transition", { ...keys, from: "authorizing", to: "exchanging" })
    try {
        const token = await exchangeGhlCode(config, code)
        const { locations, limited } = await listGhlInstalledLocations(config, token)
        if (!locations.length) throw unavailable()
        await rpc("transition", { ...keys, from: "exchanging", to: "ready", credential: encrypt({ token }), choices: locations, limited })
        destination.searchParams.set("ghl", "ready")
    } catch {
        await rpc("transition", { ...keys, from: "exchanging", to: "failed" }).catch(() => {})
        destination.searchParams.set("ghl", "failed")
    }
    return destination
}

export async function readGhlConnection(workspaceSlug: string) {
    const { attempt } = await context(workspaceSlug)
    return { relationshipId: attempt.relationship_id, phase: attempt.phase, locations: attempt.phase === "ready" ? attempt.choices : [], limited: attempt.limited, locationId: attempt.selected_location, calendars: attempt.phase === "selected" ? decrypt(attempt.credential_encrypted).calendars ?? [] : [] }
}
export async function selectGhlLocation(workspaceSlug: string, locationId: unknown) {
    const { config, keys, attempt } = await context(workspaceSlug)
    if (typeof locationId !== "string" || !/^[a-zA-Z0-9_-]{10,80}$/.test(locationId)) throw unavailable()
    if (attempt.phase !== "ready") throw new GhlConnectionError(safeMessages.phase)
    let grant: SavedGrant
    try { grant = decrypt(attempt.credential_encrypted) }
    catch (error) { throw selectionFailure("saved_authorization", error) }
    let installed: Awaited<ReturnType<typeof listGhlInstalledLocations>>
    try { installed = await listGhlInstalledLocations(config, grant.token, fetch, locationId) }
    catch (error) { throw selectionFailure("installed_accounts", error) }
    if (!installed.locations.some(location => location.id === locationId)) throw new GhlConnectionError(safeMessages.access)
    await rpc("transition", { ...keys, from: "ready", to: "selecting", locationId })
    let step: keyof typeof selectionSteps = "location_token"
    try {
        const token = await ghlLocationToken(grant.token, locationId)
        step = "calendar_list"
        const calendars = await fetchGhlCalendars({ locationId, privateToken: token.accessToken })
        if (!calendars.length) throw unavailable()
        await rpc("transition", { ...keys, from: "selecting", to: "selected", credential: encrypt({ token, calendars }) })
        return { calendars, locationId }
    } catch (error) {
        await rpc("transition", { ...keys, from: "selecting", to: "failed" }).catch(() => {})
        throw selectionFailure(step, error)
    }
}
export async function finishGhlConnection(workspaceSlug: string, calendarId: unknown) {
    const { config, keys, attempt } = await context(workspaceSlug)
    const finish = async (input: Record<string, unknown>) => {
        const result = await rpc("connect", { ...keys, ...input })
        try {
            const setup = await notificationRpc("ensure", { workspaceId: attempt.workspace_id, userId: attempt.user_id, relationshipId: attempt.relationship_id, expectedRevision: result.revision, appId: config.appId })
            return { ...result, notifications: publicNotificationSetup(setup) }
        } catch (error) {
            // The connection is already committed. Report setup separately and
            // let a retry repair it without redeeming the OAuth code again.
            return { ...result, notifications: { ready: false, sendingEnabled: false, error: error instanceof GhlConnectionError ? error.message : "Notification setup could not be completed. Retry from Client Connections." } }
        }
    }
    if (attempt.phase === "done") return finish({})
    if (attempt.phase !== "selected" || typeof calendarId !== "string") throw new GhlConnectionError(safeMessages.phase)
    const grant = decrypt(attempt.credential_encrypted), locationId = attempt.selected_location
    if (!locationId || grant.token.locationId !== locationId || !grant.calendars?.some(calendar => calendar.id === calendarId)) throw unavailable()
    const credentials = { locationId, privateToken: grant.token.accessToken }
    const [metrics, calendars] = await Promise.all([fetchGhlMetrics(credentials), fetchGhlCalendars(credentials)])
    const calendar = calendars.find(item => item.id === calendarId)
    if (!calendar || (grant.token.companyId && metrics.companyId !== grant.token.companyId)) throw unavailable()
    await fetchGhlCalendar(credentials, new Date().toISOString().slice(0, 7), { calendarId: calendar.id, calendarName: calendar.name })
    await rpc("transition", { ...keys, from: "selected", to: "connecting" })
    return finish({ appId: config.appId, companyId: grant.token.companyId ?? metrics.companyId, locationId, accessToken: grant.token.accessToken, credential: encrypt({ token: grant.token }), expiresAt: grant.token.expiresAt, accountType: "client_account", locationName: metrics.locationName, metrics: metrics.metrics, calendarId: calendar.id, calendarName: calendar.name })
}

type NotificationSetup = { profile?: { locationId: string; calendarId: string; calendarName: string; sendingEnabled: boolean; detectionEnabled: boolean; reminderMinutes: number }; revision: string; consentReady?: boolean; privateToken?: string }
async function notificationRpc(action: string, input: Record<string, unknown>): Promise<NotificationSetup> {
    const { data, error } = await supabaseAdmin.rpc("ghl_appointment_setup", { p_action: action, p_input: input })
    if (error || !data) throw unavailable()
    if (data.failure) throw new GhlConnectionError(safeMessages[String(data.failure)] ?? unavailable().message)
    return data as NotificationSetup
}
function publicNotificationSetup(setup: NotificationSetup) {
    return { ready: setup.profile?.detectionEnabled === true, sendingEnabled: setup.profile?.sendingEnabled === true, consentReady: setup.consentReady === true, reminderMinutes: setup.profile?.reminderMinutes ?? 60 }
}
export async function manageGhlNotifications(workspaceSlug: string, input: Record<string, unknown>) {
    const config = ghlOAuthConfig()
    if (typeof input.relationshipId !== "string" || !uuid.test(input.relationshipId) || typeof input.expectedRevision !== "string" || !uuid.test(input.expectedRevision) || !["notification_status", "enable_notifications", "disable_notifications"].includes(String(input.action))) throw unavailable()
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
    const keys = { workspaceId: workspace.id, userId: user.id, relationshipId: input.relationshipId, expectedRevision: input.expectedRevision, appId: config.appId }
    if (input.action === "disable_notifications") { await notificationRpc("disable", keys); return { sendingEnabled: false } }
    const setup = await notificationRpc("read", keys)
    if (input.action === "notification_status") return publicNotificationSetup(setup)
    if (process.env.GHL_APPOINTMENT_DETECTION_ENABLED !== "true" || process.env.GHL_APPOINTMENT_SENDING_ENABLED !== "true") throw new GhlConnectionError("Appointment notification sending is not enabled for this deployment yet.")
    if (!setup.profile || !setup.privateToken) throw unavailable()
    if (!setup.consentReady) throw new GhlConnectionError(safeMessages.consent)
    const { readLiveAppointmentTemplate } = await import("@/lib/ghl-appointments/delivery")
    const { validateAppointmentTemplate } = await import("@/lib/ghl-appointments/templates")
    const kinds = ["added", "rescheduled", "cancelled", "removed", "details_updated", "status_updated", "reminder"] as const
    try {
        await fetchGhlCalendar({ locationId: setup.profile.locationId, privateToken: setup.privateToken }, new Date().toISOString().slice(0, 7), { calendarId: setup.profile.calendarId, calendarName: setup.profile.calendarName })
        // Bounded pairs avoid a seven-request burst against Meta.
        for (let index = 0; index < kinds.length; index += 2) await Promise.all(kinds.slice(index, index + 2).map(async kind => validateAppointmentTemplate(await readLiveAppointmentTemplate(workspace.id, kind), kind)))
    } catch { throw new GhlConnectionError("The calendar or one of the seven approved WhatsApp templates could not be verified. Notifications remain off.") }
    return publicNotificationSetup(await notificationRpc("enable", { ...keys, verifiedAt: new Date().toISOString(), verifiedTemplates: kinds }))
}

/** Renew off the interactive portal path. A lost provider acknowledgement needs a new authorization. */
export async function renewGhlConnections() {
    if (process.env.GHL_OAUTH_ENABLED !== "true") return { renewed: 0, attention: 0, disabled: true }
    const config = ghlOAuthConfig()
    let renewed = 0, attention = 0
    // Claim one at a time: each single-use refresh token gets its own full lease.
    for (let count = 0; count < 5; count++) {
        const batch = await rpc("claim_refresh", { appId: config.appId, limit: 1 })
        const jobs = batch.items as Array<{ relationship_id: string; lease_token: string; credential_encrypted: string; location_id: string }>
        if (!jobs?.length) break
        const job = jobs[0]
        try {
            const token = await refreshGhlToken(config, decrypt(job.credential_encrypted).token)
            await rpc("finish_refresh", { relationshipId: job.relationship_id, leaseToken: job.lease_token, locationId: token.locationId, accessToken: token.accessToken, credential: encrypt({ token }), expiresAt: token.expiresAt, outcome: "success" })
            renewed++
        } catch {
            await rpc("finish_refresh", { relationshipId: job.relationship_id, leaseToken: job.lease_token, outcome: "failed" }).catch(() => {})
            attention++
        }
    }
    return { renewed, attention, disabled: false }
}
