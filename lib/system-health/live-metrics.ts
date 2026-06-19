import { getAuthorizedClickUpWorkspaces, hasClickUpConfig } from "@/lib/client-messages/clickup"
import { checkMetaWhatsAppAccess, hasMetaWhatsAppConfig } from "@/lib/client-messages/meta-whatsapp"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getStripeBalance, hasStripeConfig } from "@/lib/stripe/api"

export type LiveMetricStatus = "ok" | "warning" | "critical" | "unknown"

export type LiveMetric = {
    id: string
    provider: string
    name: string
    status: LiveMetricStatus
    value: string
    detail: string
}

const MEBIBYTE = 1024 * 1024
const GIBIBYTE = 1024 * 1024 * 1024

function formatBytes(value: number) {
    if (value >= GIBIBYTE) return `${(value / GIBIBYTE).toFixed(2)} GB`
    if (value >= MEBIBYTE) return `${(value / MEBIBYTE).toFixed(1)} MB`
    return `${Math.max(0, Math.round(value / 1024))} KB`
}

function withTimeout<T>(promise: Promise<T>, label: string) {
    return Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out`)), 4_000)
        }),
    ])
}

function missingMetric(provider: string, name: string, detail: string): LiveMetric {
    return {
        id: `${provider}-${name}`.toLowerCase().replace(/\s+/g, "-"),
        provider,
        name,
        status: "unknown",
        value: "Not connected",
        detail,
    }
}

async function getSupabaseMetric(): Promise<LiveMetric> {
    const { data, error } = await withTimeout<{
        data: unknown
        error: { message: string } | null
    }>(
        Promise.resolve(
            supabaseAdmin.rpc("get_system_health_database_size") as unknown as {
                data: unknown
                error: { message: string } | null
            }
        ),
        "Supabase database size lookup"
    )

    if (error) {
        return missingMetric(
            "Supabase",
            "Database capacity",
            error.message.includes("get_system_health_database_size")
                ? "Apply the latest Supabase migration to enable exact database-size monitoring."
                : error.message
        )
    }

    const row = Array.isArray(data) ? data[0] : data
    const bytes = Number(
        row && typeof row === "object"
            ? (row as { database_bytes?: unknown }).database_bytes
            : 0
    )
    const limitMb = Number(process.env.SYSTEM_HEALTH_SUPABASE_DATABASE_LIMIT_MB ?? "500")
    const limitBytes = (Number.isFinite(limitMb) && limitMb > 0 ? limitMb : 500) * MEBIBYTE
    const ratio = bytes / limitBytes

    return {
        id: "supabase-database-capacity",
        provider: "Supabase",
        name: "Database capacity",
        status: ratio >= 0.9 ? "critical" : ratio >= 0.75 ? "warning" : "ok",
        value: `${formatBytes(bytes)} / ${limitMb} MB`,
        detail: `${Math.round(ratio * 100)}% of the configured database limit`,
    }
}

async function getR2Metric(): Promise<LiveMetric> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
    const bucketName = process.env.R2_BUCKET_NAME?.trim()

    if (!accountId || !token || !bucketName) {
        return missingMetric(
            "Cloudflare R2",
            "Bucket capacity",
            "Add CLOUDFLARE_ACCOUNT_ID and a read-only CLOUDFLARE_API_TOKEN to monitor this bucket."
        )
    }

    const end = new Date().toISOString()
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const response = await withTimeout(
        fetch("https://api.cloudflare.com/client/v4/graphql", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: `query R2Storage($accountTag: String!, $start: Time!, $end: Time!, $bucket: String!) {
                    viewer { accounts(filter: { accountTag: $accountTag }) {
                        r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucket }, orderBy: [datetime_DESC]) {
                            max { objectCount payloadSize metadataSize }
                        }
                    }}
                }`,
                variables: {
                    accountTag: accountId,
                    start,
                    end,
                    bucket: bucketName,
                },
            }),
        }).then(async (result) => {
            const body = (await result.json()) as Record<string, unknown>
            if (!result.ok || body.errors) {
                throw new Error(`Cloudflare R2 metrics request failed (${result.status})`)
            }
            return body
        }),
        "Cloudflare R2 metrics lookup"
    )

    const groups = (response as {
        data?: { viewer?: { accounts?: Array<{ r2StorageAdaptiveGroups?: Array<{ max?: { objectCount?: number; payloadSize?: number; metadataSize?: number } }> }> } }
    }).data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups
    const storage = groups?.[0]?.max

    if (!storage) {
        return missingMetric(
            "Cloudflare R2",
            "Bucket capacity",
            "Cloudflare has not published a recent storage metric for this bucket yet."
        )
    }

    const bytes = (storage.payloadSize ?? 0) + (storage.metadataSize ?? 0)
    const freeBytes = 10 * GIBIBYTE
    const ratio = bytes / freeBytes

    return {
        id: "r2-bucket-capacity",
        provider: "Cloudflare R2",
        name: "Bucket capacity",
        status: ratio >= 0.9 ? "critical" : ratio >= 0.75 ? "warning" : "ok",
        value: `${formatBytes(bytes)} / 10 GB`,
        detail: `${storage.objectCount ?? 0} objects. Cloudflare analytics can be delayed.`,
    }
}

async function getMetaMetrics(): Promise<LiveMetric[]> {
    const sinceMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const sentTemplates = await supabaseAdmin
        .from("client_messages")
        .select("id", { count: "exact", head: true })
        .eq("provider", "meta_whatsapp")
        .eq("direction", "outbound")
        .eq("body", "[WhatsApp consent template]")
        .eq("status", "sent")
        .gte("created_at", sinceMonth)

    const localMetric: LiveMetric = {
        id: "meta-template-sends",
        provider: "Meta WhatsApp",
        name: "Consent templates sent",
        status: sentTemplates.error ? "warning" : "ok",
        value: `${sentTemplates.count ?? 0} in 30 days`,
        detail: sentTemplates.error
            ? sentTemplates.error.message
            : "Exact count of successful template sends initiated by this system.",
    }

    if (!hasMetaWhatsAppConfig()) {
        return [localMetric, missingMetric("Meta WhatsApp", "Phone number access", "Meta WhatsApp credentials are not configured.")]
    }

    try {
        const phone = await withTimeout(checkMetaWhatsAppAccess(), "Meta WhatsApp access check") as {
            display_phone_number?: string
            verified_name?: string
        }
        return [
            localMetric,
            {
                id: "meta-phone-access",
                provider: "Meta WhatsApp",
                name: "Phone number access",
                status: "ok",
                value: phone.display_phone_number ?? "Connected",
                detail: phone.verified_name ? `Verified as ${phone.verified_name}` : "Meta API accepted the configured access token.",
            },
        ]
    } catch (error) {
        return [
            localMetric,
            {
                id: "meta-phone-access",
                provider: "Meta WhatsApp",
                name: "Phone number access",
                status: "critical",
                value: "Connection failed",
                detail: error instanceof Error ? error.message : "Unknown Meta API error",
            },
        ]
    }
}

async function getStripeMetric(): Promise<LiveMetric> {
    if (!hasStripeConfig()) {
        return missingMetric("Stripe", "Available balance", "Stripe secret key is not configured.")
    }

    try {
        const balance = await withTimeout(getStripeBalance(), "Stripe balance lookup")
        const pending = balance.pending.reduce((total, item) => total + item.amount, 0)
        const available = balance.available.reduce((total, item) => total + item.amount, 0)
        const currency = balance.available[0]?.currency ?? balance.pending[0]?.currency ?? "usd"
        const formatter = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency.toUpperCase(),
        })

        return {
            id: "stripe-balance",
            provider: "Stripe",
            name: "Available balance",
            status: "ok",
            value: formatter.format(available / 100),
            detail: `${formatter.format(pending / 100)} pending settlement`,
        }
    } catch (error) {
        return {
            id: "stripe-balance",
            provider: "Stripe",
            name: "Available balance",
            status: "critical",
            value: "Connection failed",
            detail: error instanceof Error ? error.message : "Unknown Stripe API error",
        }
    }
}

async function getClickUpMetric(): Promise<LiveMetric> {
    if (!hasClickUpConfig()) {
        return missingMetric("ClickUp", "Workspace access", "ClickUp credentials are not configured.")
    }

    try {
        const workspaces = await withTimeout(getAuthorizedClickUpWorkspaces(), "ClickUp workspace lookup")
        return {
            id: "clickup-workspace-access",
            provider: "ClickUp",
            name: "Workspace access",
            status: workspaces.length > 0 ? "ok" : "warning",
            value: `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`,
            detail: "Live ClickUp API access check.",
        }
    } catch (error) {
        return {
            id: "clickup-workspace-access",
            provider: "ClickUp",
            name: "Workspace access",
            status: "critical",
            value: "Connection failed",
            detail: error instanceof Error ? error.message : "Unknown ClickUp API error",
        }
    }
}

async function getVercelMetric(): Promise<LiveMetric> {
    const token = process.env.VERCEL_API_TOKEN?.trim()
    const projectId = process.env.VERCEL_PROJECT_ID?.trim()
    const teamId = process.env.VERCEL_TEAM_ID?.trim()

    if (!token || !projectId) {
        return missingMetric(
            "Vercel",
            "Production deployment",
            "Add VERCEL_API_TOKEN and VERCEL_PROJECT_ID to monitor the latest production deployment."
        )
    }

    try {
        const params = new URLSearchParams({ projectId, limit: "1", target: "production" })
        if (teamId) params.set("teamId", teamId)
        const response = await withTimeout(
            fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            }).then(async (result) => {
                const body = (await result.json()) as {
                    deployments?: Array<{ state?: string; createdAt?: number; url?: string }>
                }
                if (!result.ok) throw new Error(`Vercel deployment lookup failed (${result.status})`)
                return body
            }),
            "Vercel deployment lookup"
        )
        const deployment = response.deployments?.[0]

        if (!deployment) {
            return {
                id: "vercel-production-deployment",
                provider: "Vercel",
                name: "Production deployment",
                status: "warning",
                value: "No production deployment found",
                detail: "The Vercel API did not return a production deployment for this project.",
            }
        }

        return {
            id: "vercel-production-deployment",
            provider: "Vercel",
            name: "Production deployment",
            status: deployment.state === "READY" ? "ok" : "warning",
            value: deployment.state ?? "Unknown",
            detail: deployment.createdAt
                ? `Latest production deployment: ${new Date(deployment.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                : "Latest production deployment returned by Vercel.",
        }
    } catch (error) {
        return {
            id: "vercel-production-deployment",
            provider: "Vercel",
            name: "Production deployment",
            status: "critical",
            value: "Connection failed",
            detail: error instanceof Error ? error.message : "Unknown Vercel API error",
        }
    }
}

export async function getLiveHealthMetrics() {
    const [supabase, r2, meta, stripe, clickup, vercel] = await Promise.all([
        getSupabaseMetric(),
        getR2Metric(),
        getMetaMetrics(),
        getStripeMetric(),
        getClickUpMetric(),
        getVercelMetric(),
    ])

    return [supabase, r2, ...meta, stripe, clickup, vercel]
}
