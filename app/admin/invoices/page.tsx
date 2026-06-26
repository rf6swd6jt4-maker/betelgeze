import Link from "next/link"
import { requireAdmin } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { AdminActionsMenu } from "@/components/admin/AdminActionsMenu"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListAutoRefresh } from "@/components/list/ListAutoRefresh"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { compactText, formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { removeInvoice, retryInvoiceAutomation } from "./actions"
import { ListToolbar } from "@/components/admin/ListToolbar"

export const dynamic = "force-dynamic"

function formatMoney(amount: number, currency: string) {
    return (amount / 100).toLocaleString("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
    })
}

function getAutomationDiagnostic(rawPayload: unknown) {
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
        return null
    }

    const payload = rawPayload as {
        error?: unknown
        meta_status?: {
            errors?: Array<{
                code?: unknown
                title?: unknown
                message?: unknown
                error_data?: {
                    details?: unknown
                }
            }>
        }
    }
    const error = typeof payload.error === "string" ? payload.error : null

    if (error) return error

    const metaError = payload.meta_status?.errors?.[0]

    if (!metaError) return null

    return [
        metaError.title,
        metaError.message,
        metaError.error_data?.details,
        typeof metaError.code === "number" ? `Meta code ${metaError.code}` : null,
    ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(": ")
}

function isManualMigration(rawPayload: unknown) {
    return Boolean(
        rawPayload &&
        typeof rawPayload === "object" &&
        !Array.isArray(rawPayload) &&
        (rawPayload as { flow?: unknown }).flow === "manual_migration"
    )
}

function getWhatsAppState(sale: {
    status: string
    consent_template_sent_at: string | null
    consent_confirmed_at: string | null
    onboarding_link_sent_at: string | null
}) {
    if (sale.status === "invoice_failed") return { label: "WA consent template not sent", tone: "red" as const }
    if (sale.status.includes("consent_template_failed")) return { label: "WA consent template failed", tone: "red" as const }
    if (sale.status === "onboarding_link_failed") return { label: "WA onboarding link failed", tone: "red" as const }
    if (sale.onboarding_link_sent_at || sale.status === "onboarding_link_sent") return { label: "Onboarding link sent", tone: "green" as const }
    if (sale.consent_confirmed_at || ["whatsapp_confirmed", "onboarding_created", "manual_workspace_created"].includes(sale.status)) return { label: "WA confirmed", tone: "green" as const }
    if (sale.consent_template_sent_at || sale.status.includes("awaiting_whatsapp_confirm")) return { label: "WA consent template sent", tone: "yellow" as const }
    return { label: "WA consent template not sent", tone: "neutral" as const }
}

function getInvoiceState(status: string, manualMigration: boolean) {
    if (manualMigration) return { label: "Invoice not issued", tone: "neutral" as const }
    if (status === "invoice_failed") return { label: "Invoice failed", tone: "red" as const }
    if (status === "invoice_creating") return { label: "Invoice creating", tone: "yellow" as const }
    if (status === "invoice_sent") return { label: "Invoice sent", tone: "yellow" as const }
    if (["paid", "test_paid", "paid_awaiting_whatsapp_confirm", "paid_consent_template_failed", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent", "onboarding_link_failed"].includes(status)) return { label: "Invoice paid", tone: "green" as const }
    return { label: "Invoice pending", tone: "neutral" as const }
}

function toneClasses(tone: "green" | "yellow" | "red" | "neutral") {
    if (tone === "green") return { text: "text-emerald-200", mark: "bg-emerald-300" }
    if (tone === "yellow") return { text: "text-yellow-200", mark: "bg-yellow-300" }
    if (tone === "red") return { text: "text-red-200", mark: "bg-red-300" }
    return { text: "text-neutral-300", mark: "bg-neutral-500" }
}

function labelPill(label: string) {
    return <span className="rounded-md border border-neutral-800 px-2 py-1 text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
}

function isAttentionStatus(status: string) {
    return (
        status.includes("failed") ||
        status === "paid" ||
        status === "paid_awaiting_whatsapp_confirm" ||
        status === "invoice_creating"
    )
}

export default async function AdminInvoicesPage({ searchParams }: { searchParams: Promise<{ sort?: string; filter?: string }> }) {
    const { workspace, user } = await requireAdmin()
    const { sort = "created-new", filter = "all" } = await searchParams

    const { data: saleRows, error: saleError } = await supabaseAdmin
        .from("client_sales")
        .select(
            "id, client_id, client_name, client_email, client_phone, status, total_amount, currency, stripe_invoice_id, stripe_hosted_invoice_url, consent_template_sent_at, consent_confirmed_at, onboarding_link_sent_at, raw_payload, created_at, updated_at, created_by"
        )
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50)

    const missingMigration =
        saleError?.message.toLowerCase().includes("client_sales") ?? false

    if (saleError && !missingMigration) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Could not load invoices.</p>
            </main>
        )
    }

    const sales = saleRows ?? []
    const creatorIds = [...new Set(sales.map((sale) => sale.created_by).filter(Boolean))] as string[]
    const { data: creators } = creatorIds.length > 0
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creators ?? []).map((creator) => [creator.user_id, creator]))
    const creatorAvatarUrls = await createUploadSignedUrls((creators ?? []).map((creator) => creator.avatar_path).filter((path): path is string => Boolean(path)))
    const paidCount = sales.filter((sale) => getInvoiceState(sale.status, isManualMigration(sale.raw_payload)).label === "Invoice paid").length
    const attentionCount = sales.filter((sale) =>
        isAttentionStatus(sale.status)
    ).length
    const totalVolume = sales.reduce(
        (total, sale) => total + sale.total_amount,
        0
    )
    const matchesInvoiceFilter = (sale: (typeof sales)[number]) => {
        if (filter === "all") return true
        if (filter === "attention") return isAttentionStatus(sale.status)
        if (filter === "paid") return getInvoiceState(sale.status, isManualMigration(sale.raw_payload)).label === "Invoice paid"
        if (filter.startsWith("creator:")) return sale.created_by === filter.slice("creator:".length)
        return true
    }
    const sortedSales = sales
        .map((sale) => ({ ...sale, isFilterMatch: matchesInvoiceFilter(sale) }))
        .sort((left, right) => {
            const time = (value: string | null | undefined) => value ? new Date(value).getTime() : 0
            if (left.isFilterMatch !== right.isFilterMatch) return left.isFilterMatch ? -1 : 1
            if (sort === "name-az") return left.client_name.localeCompare(right.client_name)
            if (sort === "amount-low") return left.total_amount - right.total_amount
            if (sort === "amount-high") return right.total_amount - left.total_amount
            if (sort === "created-old") return time(left.created_at) - time(right.created_at)
            if (sort === "updated-recent") return time(right.updated_at ?? right.created_at) - time(left.updated_at ?? left.created_at)
            return time(right.created_at) - time(left.created_at)
        })
    const invoiceCreators = (creators ?? []).map((creator) => ({ value: `creator:${creator.user_id}`, label: `@${creator.username}`, avatarSrc: creator.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) ?? null : null }))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
            <div className="mx-auto max-w-7xl">
                <ListAutoRefresh />
                <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {workspace.banner_path || workspace.logo_path ? workspace.name : "Invoices"}
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                            Track Stripe invoices, payment state, WhatsApp
                            consent, and onboarding automation from one place.
                        </p>
                    </div>

                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <Link
                            href="/admin/sales/new"
                            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3"
                        >
                            Create invoice
                        </Link>

                        <AdminActionsMenu />
                    </div>
                </div>

                <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                    <Link
                        href="/admin"
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        Clients
                    </Link>
                    <Link
                        href="/admin/invoices"
                        className="shrink-0 rounded-lg bg-white px-3 py-2.5 font-medium text-black sm:py-2"
                    >
                        Invoices
                    </Link>
                    <Link
                        href="/admin/health"
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        System health
                    </Link>
                    <Link
                        href={`/dashboard/${workspace.slug}/settings`}
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        Settings
                    </Link>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                        ["Invoices", sales.length],
                        ["Paid", paidCount],
                        ["Needs attention", attentionCount],
                    ].map(([label, value]) => (
                        <div
                            key={label}
                            className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
                        >
                            <p className="text-xs text-neutral-500">
                                {label}
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                                {value}
                            </p>
                        </div>
                    ))}
                </div>

                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">Tracked volume</p>
                    <p className="mt-1 text-lg font-semibold">
                        {formatMoney(totalVolume, sales[0]?.currency ?? "usd")}
                    </p>
                </div>

                <ListToolbar sortOptions={[{ value: "created-new", label: "Created: newest" }, { value: "created-old", label: "Created: oldest" }, { value: "name-az", label: "Client name: A–Z" }, { value: "amount-low", label: "Amount: low to high" }, { value: "amount-high", label: "Amount: high to low" }, { value: "updated-recent", label: "Last updated: recent" }]} filterGroups={[{ label: "Status", options: [{ value: "attention", label: "Needs attention" }, { value: "paid", label: "Paid" }] }, { label: "Created by", options: invoiceCreators }]} />

                {missingMigration ? (
                    <p className="mt-5 rounded-lg bg-neutral-900 p-4 text-sm text-neutral-400">
                        Apply the Stripe sales automation migration to show invoice automation status here.
                    </p>
                ) : sales.length > 0 ? (
                    <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                        {sortedSales.map((sale) => {
                            const manualMigration = isManualMigration(sale.raw_payload)
                            const diagnostic = getAutomationDiagnostic(sale.raw_payload)
                            const creator = sale.created_by ? creatorById.get(sale.created_by) : null
                            const invoiceStatus = getInvoiceState(sale.status, manualMigration)
                            const whatsappStatus = getWhatsAppState(sale)
                            const invoiceTone = toneClasses(invoiceStatus.tone)
                            const whatsappTone = toneClasses(whatsappStatus.tone)
                            const invoiceAttention = isAttentionStatus(sale.status)
                            return <div key={sale.id} className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-900 px-4 py-2.5 last:border-0 md:grid-cols-[minmax(220px,1.25fr)_100px_120px_165px_190px_100px_120px_32px] md:items-center ${sale.isFilterMatch ? "" : "opacity-35"} ${diagnostic ? "bg-red-950/[0.08]" : ""}`}>
                                <div className="min-w-0">
                                    <p className="truncate text-base font-semibold text-neutral-100">
                                        {sale.client_id ? <Link href={`/admin/client/${sale.client_id}`} className="underline-offset-4 hover:underline">{sale.client_name}</Link> : sale.client_name}
                                    </p>
                                </div>
                                <div>{labelPill("Manual")}</div>
                                <p className="text-sm font-medium text-neutral-300">{manualMigration ? "No amount" : formatMoney(sale.total_amount, sale.currency)}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex items-center gap-2 text-sm ${invoiceTone.text}`}><span className={`h-2.5 w-2.5 rotate-45 ${invoiceTone.mark}`} />{invoiceStatus.label}</span>
                                </div>
                                <span className={`inline-flex items-center gap-2 text-sm ${whatsappTone.text}`}><span className={`h-2.5 w-2.5 rotate-45 ${whatsappTone.mark}`} />{whatsappStatus.label}</span>
                                <p className="font-mono text-sm text-neutral-500">{shortId(sale.stripe_invoice_id ?? sale.id)}</p>
                                <div className="flex items-center justify-end gap-3">
                                    <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(sale.created_at)}</p>
                                    <ListCreatorBadge src={creator?.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) : null} username={creator?.username ?? null} label="Created by" date={new Date(sale.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                </div>
                                <ListActionMenu actions={[
                                    invoiceAttention ? { label: "Retry", action: retryInvoiceAutomation.bind(null, sale.id) } : {},
                                    sale.stripe_hosted_invoice_url ? { label: "Open invoice", href: sale.stripe_hosted_invoice_url, external: true } : {},
                                    sale.client_id ? { label: "Open client", href: `/admin/client/${sale.client_id}` } : {},
                                    diagnostic ? { label: "Open console", href: `#invoice-console-${sale.id}` } : {},
                                    { label: "Remove", action: removeInvoice.bind(null, sale.id), danger: true, confirmMessage: "Remove this invoice from Betelgeze? Stripe records will remain in Stripe." },
                                ]} />
                            </div>
                        })}
                    </section>
                ) : (
                    <p className="mt-5 rounded-lg bg-neutral-900 p-4 text-sm text-neutral-400">
                        No Stripe invoices have been created from this
                        dashboard yet.
                    </p>
                )}
                {sortedSales.some((sale) => getAutomationDiagnostic(sale.raw_payload)) && <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                    <div className="border-b border-neutral-800 px-5 py-4">
                        <h2 className="font-semibold">Invoice console</h2>
                        <p className="mt-1 text-sm text-neutral-500">Automation errors are collapsed by default. Open console from an invoice to jump here.</p>
                    </div>
                    {sortedSales.map((sale) => {
                        const diagnostic = getAutomationDiagnostic(sale.raw_payload)
                        if (!diagnostic) return null
                        return <div id={`invoice-console-${sale.id}`} key={sale.id} className="grid min-h-14 scroll-mt-24 gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[160px_minmax(0,1fr)_120px] md:items-center">
                            <span className="inline-flex items-center gap-2 text-sm text-red-200"><span className="h-2 w-2 rotate-45 bg-red-300" />Automation error</span>
                            <details className="min-w-0 text-sm">
                                <summary className="cursor-pointer truncate text-red-300">{compactText(diagnostic, 220)}</summary>
                                <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">{diagnostic}</p>
                            </details>
                            <p className="font-mono text-xs text-neutral-500">{shortId(sale.stripe_invoice_id ?? sale.id)}</p>
                        </div>
                    })}
                </section>}
                <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
            </div>
        </main>
    )
}
