import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { getRequiredEnv } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const INTEGRATION_PROVIDERS = ["stripe", "meta_whatsapp", "clickup"] as const
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

export function integrationHint(provider: IntegrationProvider, config: IntegrationConfig) {
    if (provider === "stripe") return { key_suffix: config.secret_key?.slice(-4) ?? null, currency: config.default_currency || "usd" }
    if (provider === "meta_whatsapp") return { phone_number_id: config.phone_number_id || null, template: config.consent_template_name || null }
    return { workspace_id: config.workspace_id || null, space_id: config.clients_space_id || null }
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
