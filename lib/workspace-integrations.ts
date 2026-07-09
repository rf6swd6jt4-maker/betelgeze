import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { getRequiredEnv } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const INTEGRATION_PROVIDERS = ["stripe", "meta_whatsapp"] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]
export type IntegrationConfig = Record<string, string>

function encryptionKey() {
    const key = Buffer.from(getRequiredEnv("WORKSPACE_INTEGRATION_ENCRYPTION_KEY"), "base64")
    if (key.length !== 32) throw new Error("WORKSPACE_INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.")
    return key
}

function encrypt(config: IntegrationConfig) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")
}

export function decryptWorkspaceIntegration(value: string): IntegrationConfig {
    const payload = Buffer.from(value, "base64")
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as IntegrationConfig
}

export function integrationHint(provider: IntegrationProvider, config: IntegrationConfig): Record<string, string | null> {
    if (provider === "stripe") return { key_suffix: config.secret_key?.slice(-4) ?? null, currency: config.default_currency || "usd" }
    if (provider === "meta_whatsapp") return { phone_number_id: config.phone_number_id || null, template: config.consent_template_name || null }
    return {}
}

export async function saveWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider, config: IntegrationConfig, userId: string) {
    const cleaned = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0))
    const { error } = await supabaseAdmin.from("workspace_integrations").upsert({
        workspace_id: workspaceId,
        provider,
        enabled: true,
        mode: "connected",
        config_encrypted: encrypt(cleaned),
        config_hint: integrationHint(provider, cleaned),
        configured_at: new Date().toISOString(),
        configured_by: userId,
        connected_account_id: "manual",
    })
    if (error) throw new Error("Could not save this connection.")
}

export async function verifyWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider) {
    const config = await getWorkspaceProviderConfig(workspaceId, provider)
    if (!config) throw new Error("This connection has not been configured yet.")

    let hint: Record<string, string | null> = {}

    if (provider === "stripe") {
        const response = await fetch("https://api.stripe.com/v1/account", {
            headers: { Authorization: `Bearer ${config.secret_key}` },
            cache: "no-store",
        })
        if (!response.ok) throw new Error("Stripe could not verify this secret key.")
        const account = await response.json() as { id?: string; livemode?: boolean }
        hint = { ...integrationHint(provider, config), account_id: account.id ?? null, mode: account.livemode ? "live" : "test" }
    } else if (provider === "meta_whatsapp") {
        const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(config.phone_number_id)}?fields=display_phone_number,verified_name`, {
            headers: { Authorization: `Bearer ${config.access_token}` },
            cache: "no-store",
        })
        if (!response.ok) throw new Error("Meta could not verify this WhatsApp connection.")
        const phone = await response.json() as { display_phone_number?: string; verified_name?: string }
        hint = { ...integrationHint(provider, config), display_phone_number: phone.display_phone_number ?? null, verified_name: phone.verified_name ?? null }
    }

    const { error } = await supabaseAdmin
        .from("workspace_integrations")
        .update({ config_hint: { ...hint, verified_at: new Date().toISOString() } })
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
        .eq("mode", "connected")
    if (error) throw new Error("Could not record the successful connection check.")
}

// This is deliberately conservative while the provider request/webhook adapters
// are being moved off global Vercel variables. It prevents a new workspace from
// ever accidentally using ScaylUp's account.
export async function requireLegacyProviderAccess(workspaceId: string, provider: IntegrationProvider) {
    const { data } = await supabaseAdmin
        .from("workspace_integrations")
        .select("enabled, mode")
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
        .maybeSingle()
    if (data?.enabled && data.mode === "platform_legacy") return
    throw new Error(`${provider} is not connected for this workspace yet.`)
}

export async function getWorkspaceProviderConfig(workspaceId: string, provider: IntegrationProvider) {
    const { data } = await supabaseAdmin
        .from("workspace_integrations")
        .select("enabled, mode, config_encrypted")
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
        .maybeSingle()
    if (!data?.enabled) throw new Error(`${provider} is not connected for this workspace.`)
    if (data.mode === "connected" && data.config_encrypted) return decryptWorkspaceIntegration(data.config_encrypted)
    if (data.mode === "platform_legacy" && provider === "stripe") return { secret_key: getRequiredEnv("STRIPE_SECRET_KEY"), webhook_secret: getRequiredEnv("STRIPE_WEBHOOK_SECRET"), default_currency: process.env.STRIPE_DEFAULT_CURRENCY ?? "usd" }
    throw new Error(`${provider} is not connected for this workspace.`)
}

export async function getStripeWebhookCandidates() {
    const { data } = await supabaseAdmin
        .from("workspace_integrations")
        .select("workspace_id, mode, enabled, config_encrypted")
        .eq("provider", "stripe")
        .eq("enabled", true)
    return (data ?? []).flatMap((item) => {
        try {
            if (item.mode === "platform_legacy") return [{ workspaceId: item.workspace_id, webhookSecret: getRequiredEnv("STRIPE_WEBHOOK_SECRET") }]
            if (item.mode === "connected" && item.config_encrypted) {
                const config = decryptWorkspaceIntegration(item.config_encrypted)
                return config.webhook_secret ? [{ workspaceId: item.workspace_id, webhookSecret: config.webhook_secret }] : []
            }
        } catch {
            return []
        }
        return []
    })
}
