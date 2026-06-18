import Link from "next/link"
import { requireAdmin } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { displayMessageAddress } from "@/lib/client-messages/addresses"
import { AdminActionsMenu } from "@/components/admin/AdminActionsMenu"

export const dynamic = "force-dynamic"

type HealthStatus = "ok" | "warning" | "critical" | "unknown"

type HealthCheck = {
    id: string
    name: string
    provider: string
    status: HealthStatus
    summary: string
    detail?: string
    value?: string
}

type DiagnosticMessage = {
    id: string
    direction: string
    from_address: string | null
    to_address: string | null
    body: string | null
    status: string
    error: string | null
    created_at: string
}

function hasEnv(name: string) {
    return Boolean(process.env[name]?.trim())
}

function statusRank(status: HealthStatus) {
    switch (status) {
        case "critical":
            return 3
        case "warning":
            return 2
        case "unknown":
            return 1
        case "ok":
            return 0
    }
}

function getWorstStatus(checks: HealthCheck[]): HealthStatus {
    return checks.reduce<HealthStatus>(
        (worst, check) =>
            statusRank(check.status) > statusRank(worst)
                ? check.status
                : worst,
        "ok"
    )
}

function statusStyles(status: HealthStatus) {
    switch (status) {
        case "ok":
            return {
                dot: "bg-emerald-300",
                badge: "bg-emerald-500/10 text-emerald-200",
                border: "border-emerald-400/20",
                bar: "bg-emerald-300",
            }
        case "warning":
            return {
                dot: "bg-amber-300",
                badge: "bg-amber-500/10 text-amber-100",
                border: "border-amber-400/25",
                bar: "bg-amber-300",
            }
        case "critical":
            return {
                dot: "bg-red-300",
                badge: "bg-red-500/10 text-red-200",
                border: "border-red-400/25",
                bar: "bg-red-300",
            }
        case "unknown":
            return {
                dot: "bg-neutral-400",
                badge: "bg-neutral-800 text-neutral-300",
                border: "border-neutral-800",
                bar: "bg-neutral-500",
            }
    }
}

function formatStatus(status: HealthStatus) {
    return status === "ok" ? "Healthy" : status
}

function countByStatus(checks: HealthCheck[], status: HealthStatus) {
    return checks.filter((check) => check.status === status).length
}

function checkEnvGroup({
    id,
    provider,
    required,
    optional = [],
    name = "Configuration",
}: {
    id: string
    provider: string
    required: string[]
    optional?: string[]
    name?: string
}): HealthCheck {
    const missingRequired = required.filter((key) => !hasEnv(key))
    const missingOptional = optional.filter((key) => !hasEnv(key))

    if (missingRequired.length > 0) {
        return {
            id,
            provider,
            name,
            status: "critical",
            summary: `${missingRequired.length} required variable${missingRequired.length === 1 ? "" : "s"} missing`,
            detail: missingRequired.join(", "),
        }
    }

    if (missingOptional.length > 0) {
        return {
            id,
            provider,
            name,
            status: "warning",
            summary: "Core config is present; optional monitoring is incomplete",
            detail: `Missing optional: ${missingOptional.join(", ")}`,
        }
    }

    return {
        id,
        provider,
        name,
        status: "ok",
        summary: "Required configuration is present",
    }
}

function isRecent(dateValue: string | null | undefined, hours: number) {
    if (!dateValue) return false

    return Date.now() - new Date(dateValue).getTime() < hours * 60 * 60 * 1000
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralValue}`
}

export default async function AdminHealthPage() {
    await requireAdmin()

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [
        clientsCountResult,
        channelCountResult,
        failedMessageResult,
        unmatchedMessageResult,
        recentDiagnosticsResult,
        saleRowsResult,
        stripeEventsResult,
    ] = await Promise.all([
        supabaseAdmin
            .from("clients")
            .select("id", { count: "exact", head: true })
            .is("archived_at", null),
        supabaseAdmin
            .from("client_communication_channels")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
        supabaseAdmin
            .from("client_messages")
            .select("id", { count: "exact", head: true })
            .in("status", ["send_failed", "delivery_failed", "webhook_failed"])
            .gte("created_at", since24h),
        supabaseAdmin
            .from("client_messages")
            .select("id", { count: "exact", head: true })
            .eq("provider", "meta_whatsapp")
            .is("client_id", null)
            .eq("status", "unmatched"),
        supabaseAdmin
            .from("client_messages")
            .select(
                "id, direction, from_address, to_address, body, status, error, created_at"
            )
            .eq("provider", "meta_whatsapp")
            .is("client_id", null)
            .order("created_at", { ascending: false })
            .limit(20),
        supabaseAdmin
            .from("client_sales")
            .select(
                "id, status, created_at, updated_at, consent_template_sent_at, onboarding_link_sent_at"
            )
            .order("created_at", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("stripe_events")
            .select("id, event_type, processed_at")
            .order("processed_at", { ascending: false })
            .limit(1),
    ])

    const diagnostics =
        (recentDiagnosticsResult.data as DiagnosticMessage[] | null) ?? []
    const sales = saleRowsResult.data ?? []
    const failedSales = sales.filter((sale) => sale.status.includes("failed"))
    const staleSales = sales.filter(
        (sale) =>
            sale.status === "paid_awaiting_whatsapp_confirm" &&
            !isRecent(sale.consent_template_sent_at ?? sale.updated_at, 24)
    )
    const pendingSales = sales.filter((sale) =>
        ["invoice_creating", "paid", "paid_awaiting_whatsapp_confirm"].includes(
            sale.status
        )
    )
    const activeChannels = channelCountResult.count ?? 0
    const activeClients = clientsCountResult.count ?? 0
    const recentFailedMessages = failedMessageResult.count ?? 0
    const unmatchedMessages = unmatchedMessageResult.count ?? 0
    const latestStripeEvent = stripeEventsResult.data?.[0]

    const checks: HealthCheck[] = [
        {
            id: "app-supabase",
            provider: "Supabase",
            name: "Application database",
            status:
                clientsCountResult.error ||
                channelCountResult.error ||
                failedMessageResult.error
                    ? "critical"
                    : "ok",
            summary:
                clientsCountResult.error ||
                channelCountResult.error ||
                failedMessageResult.error
                    ? "The app could not read one or more required tables"
                    : "Database reads are working",
            detail:
                clientsCountResult.error?.message ??
                channelCountResult.error?.message ??
                failedMessageResult.error?.message ??
                undefined,
            value: plural(activeClients, "active client"),
        },
        checkEnvGroup({
            id: "supabase-config",
            provider: "Supabase",
            required: [
                "NEXT_PUBLIC_SUPABASE_URL",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                "SUPABASE_SERVICE_ROLE_KEY",
            ],
            optional: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"],
            name: "API configuration",
        }),
        checkEnvGroup({
            id: "stripe-config",
            provider: "Stripe",
            required: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
            name: "Invoice automation",
        }),
        {
            id: "stripe-events",
            provider: "Stripe",
            name: "Webhook activity",
            status: stripeEventsResult.error
                ? "warning"
                : latestStripeEvent
                  ? "ok"
                  : "warning",
            summary: stripeEventsResult.error
                ? "Could not read Stripe webhook events"
                : latestStripeEvent
                  ? `Latest event: ${latestStripeEvent.event_type}`
                  : "No Stripe webhook events recorded yet",
            detail: stripeEventsResult.error?.message,
            value: latestStripeEvent
                ? new Date(latestStripeEvent.processed_at).toLocaleString(
                      "en-US",
                      {
                          dateStyle: "medium",
                          timeStyle: "short",
                      }
                  )
                : undefined,
        },
        {
            id: "invoice-automation",
            provider: "Stripe",
            name: "Invoice pipeline",
            status: saleRowsResult.error
                ? "warning"
                : failedSales.length > 0
                  ? "critical"
                  : staleSales.length > 0
                    ? "warning"
                    : "ok",
            summary: saleRowsResult.error
                ? "Could not read invoice automation rows"
                : failedSales.length > 0
                  ? `${plural(failedSales.length, "invoice")} failed`
                  : staleSales.length > 0
                    ? `${plural(staleSales.length, "invoice")} is waiting on WhatsApp confirmation`
                    : "No failed invoice automations in the latest rows",
            detail: saleRowsResult.error?.message,
            value: `${pendingSales.length} pending`,
        },
        checkEnvGroup({
            id: "meta-config",
            provider: "Meta WhatsApp",
            required: [
                "META_WHATSAPP_ACCESS_TOKEN",
                "META_WHATSAPP_PHONE_NUMBER_ID",
                "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
                "META_WHATSAPP_CONSENT_TEMPLATE_NAME",
            ],
            optional: ["META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE"],
            name: "Messaging configuration",
        }),
        {
            id: "meta-delivery",
            provider: "Meta WhatsApp",
            name: "Bridge delivery",
            status:
                recentFailedMessages > 0
                    ? "critical"
                    : unmatchedMessages > 0
                      ? "warning"
                      : "ok",
            summary:
                recentFailedMessages > 0
                    ? `${plural(recentFailedMessages, "delivery failure")} in 24h`
                    : unmatchedMessages > 0
                      ? `${plural(unmatchedMessages, "unmatched message")} needs review`
                      : "No recent delivery failures or unmatched messages",
            value: plural(activeChannels, "active channel"),
        },
        checkEnvGroup({
            id: "clickup-config",
            provider: "ClickUp",
            required: [
                "CLICKUP_API_TOKEN",
                "CLICKUP_WORKSPACE_ID",
                "CLICKUP_CLIENTS_SPACE_ID",
                "CLICKUP_CLIENT_FOLDER_TEMPLATE_ID",
            ],
            optional: ["CLIENT_MESSAGES_BRIDGE_SECRET"],
            name: "Client workspace setup",
        }),
        checkEnvGroup({
            id: "r2-config",
            provider: "Cloudflare R2",
            required: [
                "R2_ACCOUNT_ID",
                "R2_ACCESS_KEY_ID",
                "R2_SECRET_ACCESS_KEY",
                "R2_BUCKET_NAME",
            ],
            optional: [
                "R2_PUBLIC_BASE_URL",
                "CLOUDFLARE_ACCOUNT_ID",
                "CLOUDFLARE_API_TOKEN",
            ],
            name: "File storage",
        }),
        {
            id: "vercel-runtime",
            provider: "Vercel",
            name: "Runtime",
            status: hasEnv("VERCEL") || hasEnv("VERCEL_URL") ? "ok" : "unknown",
            summary:
                hasEnv("VERCEL") || hasEnv("VERCEL_URL")
                    ? "Running with Vercel runtime metadata"
                    : "Vercel runtime metadata is not available locally",
            detail: hasEnv("VERCEL_GIT_COMMIT_SHA")
                ? `Commit ${process.env.VERCEL_GIT_COMMIT_SHA}`
                : undefined,
            value: process.env.VERCEL_ENV,
        },
        checkEnvGroup({
            id: "vercel-monitoring",
            provider: "Vercel",
            required: [],
            optional: ["VERCEL_API_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"],
            name: "Management API monitoring",
        }),
    ]

    const worstStatus = getWorstStatus(checks)
    const styles = statusStyles(worstStatus)
    const okCount = countByStatus(checks, "ok")
    const warningCount = countByStatus(checks, "warning")
    const criticalCount = countByStatus(checks, "critical")
    const unknownCount = countByStatus(checks, "unknown")
    const score = Math.round((okCount / checks.length) * 100)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Agency Onboarding
                </p>

                <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            System health
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                            Check operational signals across invoices,
                            WhatsApp, ClickUp, storage, and infrastructure.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Link
                            href="/admin/sales/new"
                            className="inline-flex justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"
                        >
                            Create invoice
                        </Link>

                        <AdminActionsMenu />
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 text-sm">
                    <Link
                        href="/admin"
                        className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300"
                    >
                        Clients
                    </Link>
                    <Link
                        href="/admin/invoices"
                        className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300"
                    >
                        Invoices
                    </Link>
                    <Link
                        href="/admin/health"
                        className="rounded-lg bg-white px-3 py-2 font-medium text-black"
                    >
                        System health
                    </Link>
                </div>

                <section
                    className={`mt-5 rounded-lg border ${styles.border} bg-neutral-900 p-4`}
                >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <span
                                    className={`h-2.5 w-2.5 rounded-full ${styles.dot}`}
                                />
                                <span
                                    className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${styles.badge}`}
                                >
                                    {formatStatus(worstStatus)}
                                </span>
                            </div>
                            <h2 className="mt-3 text-xl font-semibold">
                                {criticalCount > 0
                                    ? "Action needed"
                                    : warningCount > 0
                                      ? "Mostly healthy"
                                      : "System is healthy"}
                            </h2>
                            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
                                This page uses cached database signals and
                                lightweight configuration checks. It does not
                                live-poll every provider on each page load.
                            </p>
                        </div>

                        <div className="min-w-48">
                            <div className="flex items-end justify-between">
                                <span className="text-sm text-neutral-500">
                                    Health score
                                </span>
                                <span className="text-3xl font-semibold">
                                    {score}%
                                </span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
                                <div
                                    className={`h-full rounded-full ${styles.bar}`}
                                    style={{ width: `${score}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </section>

                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {(
                        [
                            ["Healthy", okCount, "ok"],
                            ["Warnings", warningCount, "warning"],
                            ["Critical", criticalCount, "critical"],
                            ["Unknown", unknownCount, "unknown"],
                        ] satisfies Array<[string, number, HealthStatus]>
                    ).map(([label, value, status]) => {
                        const itemStyles = statusStyles(status)

                        return (
                            <div
                                key={label}
                                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`h-2 w-2 rounded-full ${itemStyles.dot}`}
                                    />
                                    <p className="text-xs text-neutral-500">
                                        {label}
                                    </p>
                                </div>
                                <p className="mt-1 text-lg font-semibold">
                                    {value}
                                </p>
                            </div>
                        )
                    })}
                </div>

                <section className="mt-5 grid gap-3 lg:grid-cols-2">
                    {checks.map((check) => {
                        const checkStyles = statusStyles(check.status)

                        return (
                            <article
                                key={check.id}
                                className={`rounded-lg border ${checkStyles.border} bg-neutral-900 p-4`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                            {check.provider}
                                        </p>
                                        <h3 className="mt-1 font-medium text-neutral-100">
                                            {check.name}
                                        </h3>
                                    </div>
                                    <span
                                        className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${checkStyles.badge}`}
                                    >
                                        {formatStatus(check.status)}
                                    </span>
                                </div>

                                <p className="mt-3 text-sm text-neutral-300">
                                    {check.summary}
                                </p>

                                {(check.detail || check.value) && (
                                    <div className="mt-3 grid gap-2 text-xs text-neutral-500">
                                        {check.value && <p>{check.value}</p>}
                                        {check.detail && (
                                            <p className="break-words">
                                                {check.detail}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </article>
                        )
                    })}
                </section>

                <section className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                WhatsApp bridge
                            </p>
                            <h2 className="mt-1 text-lg font-semibold">
                                Unmatched message diagnostics
                            </h2>
                        </div>
                        <p className="text-sm text-neutral-500">
                            {plural(diagnostics.length, "recent event")}
                        </p>
                    </div>

                    <p className="mt-2 text-sm text-neutral-400">
                        Webhook events that reached the app but were not
                        attached to a client.
                    </p>

                    <div className="mt-4 grid gap-2">
                        {diagnostics.length > 0 ? (
                            diagnostics.map((message) => (
                                <div
                                    key={message.id}
                                    className="rounded-lg bg-neutral-950 p-3"
                                >
                                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                                        <div>
                                            <p className="whitespace-pre-wrap text-sm text-neutral-100">
                                                {message.body}
                                            </p>

                                            {(message.from_address ||
                                                message.to_address) && (
                                                <p className="mt-1 break-all text-xs text-neutral-500">
                                                    {message.from_address
                                                        ? `From ${displayMessageAddress(message.from_address)}`
                                                        : null}
                                                    {message.from_address &&
                                                    message.to_address
                                                        ? " · "
                                                        : null}
                                                    {message.to_address
                                                        ? `To ${displayMessageAddress(message.to_address)}`
                                                        : null}
                                                </p>
                                            )}
                                        </div>

                                        <span
                                            className={`w-fit rounded-md px-2 py-1 text-xs ${
                                                message.status.includes(
                                                    "failed"
                                                ) ||
                                                message.status === "unmatched"
                                                    ? "bg-red-500/10 text-red-200"
                                                    : "bg-neutral-800 text-neutral-300"
                                            }`}
                                        >
                                            {message.direction} ·{" "}
                                            {message.status}
                                        </span>
                                    </div>

                                    {message.error && (
                                        <p className="mt-2 text-xs text-red-200">
                                            {message.error}
                                        </p>
                                    )}

                                    <p className="mt-3 text-xs text-neutral-500">
                                        {new Date(
                                            message.created_at
                                        ).toLocaleString("en-US", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                        })}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <p className="rounded-lg bg-neutral-950 p-3 text-sm text-neutral-500">
                                No unmatched bridge diagnostics.
                            </p>
                        )}
                    </div>
                </section>
            </div>
        </main>
    )
}
