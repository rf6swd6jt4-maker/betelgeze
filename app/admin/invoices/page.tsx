import Link from "next/link"
import { requireAdmin } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { DashboardMenus } from "@/components/admin/DashboardMenus"

export const dynamic = "force-dynamic"

function formatStatus(value: string) {
    return value.replace(/_/g, " ")
}

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
    return (
        rawPayload &&
        typeof rawPayload === "object" &&
        !Array.isArray(rawPayload) &&
        (rawPayload as { flow?: unknown }).flow === "manual_migration"
    )
}

function getWhatsAppState(sale: {
    consent_template_sent_at: string | null
    consent_confirmed_at: string | null
    onboarding_link_sent_at: string | null
}) {
    if (sale.onboarding_link_sent_at) return "Onboarding link sent"
    if (sale.consent_confirmed_at) return "WhatsApp confirmed"
    if (sale.consent_template_sent_at) return "Consent template sent"

    return "Consent template not sent"
}

function isAttentionStatus(status: string) {
    return (
        status.includes("failed") ||
        status === "paid" ||
        status === "paid_awaiting_whatsapp_confirm" ||
        status === "invoice_creating"
    )
}

export default async function AdminInvoicesPage() {
    const { workspace, user } = await requireAdmin()

    const { data: saleRows, error: saleError } = await supabaseAdmin
        .from("client_sales")
        .select(
            "id, client_id, client_name, client_email, client_phone, status, total_amount, currency, stripe_invoice_id, stripe_hosted_invoice_url, consent_template_sent_at, consent_confirmed_at, onboarding_link_sent_at, raw_payload, created_at, updated_at"
        )
        .eq("workspace_id", workspace.id)
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
    const paidCount = sales.filter((sale) =>
        ["paid", "paid_awaiting_whatsapp_confirm", "onboarding_created", "onboarding_link_sent"].includes(
            sale.status
        )
    ).length
    const attentionCount = sales.filter((sale) =>
        isAttentionStatus(sale.status)
    ).length
    const totalVolume = sales.reduce(
        (total, sale) => total + sale.total_amount,
        0
    )

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Agency Onboarding
                </p>

                <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Invoices
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                            Track Stripe invoices, payment state, WhatsApp
                            consent, and onboarding automation from one place.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Link
                            href="/admin/sales/new"
                            className="inline-flex justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"
                        >
                            Create invoice
                        </Link>

                        <DashboardMenus userId={user.id} workspace={workspace} />
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
                        className="rounded-lg bg-white px-3 py-2 font-medium text-black"
                    >
                        Invoices
                    </Link>
                    <Link
                        href="/admin/health"
                        className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300"
                    >
                        System health
                    </Link>
                    <Link
                        href="/admin/users"
                        className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300"
                    >
                        Users
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

                {missingMigration ? (
                    <p className="mt-5 rounded-lg bg-neutral-900 p-4 text-sm text-neutral-400">
                        Apply the Stripe sales automation migration to show
                        invoice automation status here.
                    </p>
                ) : sales.length > 0 ? (
                    <div className="mt-5 overflow-hidden rounded-lg border border-neutral-800">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                                <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">
                                            Client
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Invoice
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Automation
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Amount
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Updated
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Options
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sales.map((sale) => {
                                        const manualMigration = isManualMigration(
                                            sale.raw_payload
                                        )
                                        const diagnostic =
                                            getAutomationDiagnostic(
                                                sale.raw_payload
                                            )

                                        return (
                                            <tr
                                                key={sale.id}
                                                className="border-t border-neutral-800 bg-neutral-950/40"
                                            >
                                                <td className="px-3 py-3 align-top">
                                                    <p className="font-medium text-neutral-100">
                                                        {sale.client_id ? (
                                                            <Link
                                                                href={`/admin/client/${sale.client_id}`}
                                                                className="underline-offset-4 hover:underline"
                                                            >
                                                                {sale.client_name}
                                                            </Link>
                                                        ) : (
                                                            sale.client_name
                                                        )}
                                                    </p>
                                                    <p className="mt-1 text-xs text-neutral-500">
                                                        {sale.client_email ??
                                                            sale.client_phone}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-3 align-top">
                                                    <span className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
                                                        {manualMigration
                                                            ? "manual client migration"
                                                            : formatStatus(
                                                                  sale.status
                                                              )}
                                                    </span>
                                                    <p className="mt-2 font-mono text-xs text-neutral-500">
                                                        {manualMigration
                                                            ? "No Stripe invoice"
                                                            : (sale.stripe_invoice_id ??
                                                              "No Stripe invoice yet")}
                                                    </p>
                                                    {diagnostic && (
                                                        <p className="mt-2 max-w-sm text-xs text-red-300">
                                                            {diagnostic}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 align-top">
                                                    <p className="text-neutral-300">
                                                        {getWhatsAppState(sale)}
                                                    </p>
                                                    <p className="mt-1 text-xs text-neutral-500">
                                                        {sale.client_id
                                                            ? "Client created"
                                                            : "Client not created yet"}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-3 align-top text-neutral-300">
                                                    {manualMigration
                                                        ? "-"
                                                        : formatMoney(
                                                              sale.total_amount,
                                                              sale.currency
                                                          )}
                                                </td>
                                                <td className="px-3 py-3 align-top text-neutral-400">
                                                    {new Date(
                                                        sale.updated_at ??
                                                            sale.created_at
                                                    ).toLocaleString("en-US", {
                                                        dateStyle: "medium",
                                                        timeStyle: "short",
                                                    })}
                                                </td>
                                                <td className="px-3 py-3 align-top">
                                                    <div className="flex flex-col gap-2">
                                                        {sale.stripe_hosted_invoice_url && (
                                                            <a
                                                                href={
                                                                    sale.stripe_hosted_invoice_url
                                                                }
                                                                className="rounded-lg border border-neutral-700 px-3 py-2 text-center text-xs font-medium text-neutral-200 hover:border-neutral-500 hover:text-white"
                                                                target="_blank"
                                                                rel="noreferrer"
                                                            >
                                                                Open invoice
                                                            </a>
                                                        )}
                                                        {sale.client_id && (
                                                            <Link
                                                                href={`/admin/client/${sale.client_id}`}
                                                                className="rounded-lg border border-neutral-700 px-3 py-2 text-center text-xs font-medium text-neutral-200 hover:border-neutral-500 hover:text-white"
                                                            >
                                                                Open client
                                                            </Link>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <p className="mt-5 rounded-lg bg-neutral-900 p-4 text-sm text-neutral-400">
                        No Stripe invoices have been created from this
                        dashboard yet.
                    </p>
                )}
            </div>
        </main>
    )
}
