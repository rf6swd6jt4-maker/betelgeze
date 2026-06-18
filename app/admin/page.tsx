import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { displayMessageAddress } from "@/lib/client-messages/addresses"
export const dynamic = "force-dynamic"

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
    },
]

export default async function AdminPage() {
    await requireAdmin()

    const clientsResponse = await supabaseAdmin
        .from("clients")
        .select("id, name, email, phone, created_at, archived_at, is_test")
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    let clients = clientsResponse.data
    let clientsError = clientsResponse.error

    if (clientsResponse.error?.message.toLowerCase().includes("phone")) {
        const fallbackClientsResponse = await supabaseAdmin
            .from("clients")
            .select("id, name, email, created_at, archived_at, is_test")
            .is("archived_at", null)
            .order("created_at", { ascending: false })

        clients =
            fallbackClientsResponse.data?.map((client) => ({
                ...client,
                phone: null,
            })) ?? null
        clientsError = fallbackClientsResponse.error
    }

    const [
        { data: progressRows, error: progressError },
        { data: moduleRows, error: modulesError },
        { data: serviceRows, error: servicesError },
        { data: communicationRows, error: communicationError },
        { data: diagnosticRows, error: diagnosticError },
        { data: saleRows, error: saleError },
    ] = await Promise.all([
        supabaseAdmin
            .from("client_progress")
            .select("client_id, step_key, completed_at, created_at"),
        supabaseAdmin.from("client_modules").select("client_id, module_key"),
        supabaseAdmin.from("client_services").select("client_id, service_key"),
        supabaseAdmin
            .from("client_communication_channels")
            .select("client_id, clickup_channel_id, is_active"),
        supabaseAdmin
            .from("client_messages")
            .select(
                "id, direction, from_address, to_address, body, status, error, created_at"
            )
            .eq("provider", "meta_whatsapp")
            .is("client_id", null)
            .order("created_at", { ascending: false })
            .limit(12),
        supabaseAdmin
            .from("client_sales")
            .select(
                "id, client_id, client_name, client_email, client_phone, status, total_amount, currency, stripe_invoice_id, stripe_hosted_invoice_url, created_at, updated_at"
            )
            .order("created_at", { ascending: false })
            .limit(8),
    ])

    if (
        clientsError ||
        progressError ||
        modulesError ||
        servicesError ||
        communicationError ||
        diagnosticError ||
        (saleError &&
            !saleError.message.toLowerCase().includes("client_sales"))
    ) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Could not load admin dashboard.</p>
            </main>
        )
    }

    const progressByClient = new Map<string, string[]>()
    const activityByClient = new Map<string, string>()

    for (const row of progressRows ?? []) {
        const existing = progressByClient.get(row.client_id) ?? []
        existing.push(row.step_key)
        progressByClient.set(row.client_id, existing)

        const activityDate = row.completed_at ?? row.created_at
        const existingActivity = activityByClient.get(row.client_id)

        if (
            activityDate &&
            (!existingActivity ||
                new Date(activityDate) > new Date(existingActivity))
        ) {
            activityByClient.set(row.client_id, activityDate)
        }
    }

    const modulesByClient = new Map<string, string[]>()
    const servicesByClient = new Map<string, string[]>()
    const communicationByClient = new Map<
        string,
        { clickup_channel_id: string | null; is_active: boolean | null }
    >()

    for (const row of moduleRows ?? []) {
        const existing = modulesByClient.get(row.client_id) ?? []
        existing.push(row.module_key)
        modulesByClient.set(row.client_id, existing)
    }

    for (const row of serviceRows ?? []) {
        const existing = servicesByClient.get(row.client_id) ?? []
        existing.push(row.service_key)
        servicesByClient.set(row.client_id, existing)
    }

    for (const row of communicationRows ?? []) {
        communicationByClient.set(row.client_id, {
            clickup_channel_id: row.clickup_channel_id,
            is_active: row.is_active,
        })
    }

    const clientSummaries = (clients ?? []).map((client) => {
        const completedKeys = progressByClient.get(client.id) ?? []
        const assignedModuleKeys = modulesByClient.get(client.id) ?? []
        const assignedServiceKeys = servicesByClient.get(client.id) ?? []
        const communication = communicationByClient.get(client.id) ?? null

        const moduleSteps = assignedModuleKeys.flatMap((moduleKey) => {
            const moduleDefinition = MODULES[moduleKey]

            if (!moduleDefinition) return []

            return moduleDefinition.steps.map((step) => ({
                ...step,
                moduleTitle: moduleDefinition.title,
            }))
        })

        const completableSteps = [...BASE_STEPS, ...moduleSteps]

        const percentage = getProgressPercentage(
            completableSteps,
            completedKeys
        )

        const currentStep =
            completableSteps.find((step) => !completedKeys.includes(step.key)) ??
            {
                key: "final",
                title: "Complete",
                moduleTitle: "General",
            }

        const lastActivity = activityByClient.get(client.id)
        const stuck = isOnboardingStuck({
            percentage,
            createdAt: client.created_at,
            lastActivityAt: lastActivity,
        })

        return {
            client,
            assignedModuleKeys,
            assignedServiceKeys,
            percentage,
            currentStep,
            lastActivity,
            communication,
            stuck,
        }
    })
    const totalClients = clientSummaries.length
    const completedClients = clientSummaries.filter(
        ({ percentage }) => percentage === 100
    ).length
    const activeClients = totalClients - completedClients

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Agency Onboarding
                </p>

                <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Admin dashboard
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                            Track client onboarding progress, modules, and
                            activity from one place.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Link
                            href="/admin/new"
                            className="inline-flex justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-black"
                        >
                            Add client
                        </Link>

                        <Link
                            href="/admin/sales/new"
                            className="inline-flex justify-center rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-white"
                        >
                            Create invoice
                        </Link>

                        <Link
                            href="/admin/logout"
                            className="inline-flex justify-center rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-white"
                        >
                            Log out
                        </Link>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                    {[
                        ["Clients", totalClients],
                        ["Active", activeClients],
                        ["Complete", completedClients],
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

                <section className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                Stripe automation
                            </p>
                            <h2 className="mt-1 text-lg font-semibold">
                                Recent invoices
                            </h2>
                        </div>

                        <Link
                            href="/admin/sales/new"
                            className="rounded-lg border border-neutral-700 px-3 py-2 text-center text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white"
                        >
                            Create invoice
                        </Link>
                    </div>

                    {saleError?.message
                        .toLowerCase()
                        .includes("client_sales") ? (
                        <p className="mt-4 rounded-lg bg-neutral-950 p-3 text-sm text-neutral-500">
                            Apply the Stripe sales automation migration to show
                            invoice automation status here.
                        </p>
                    ) : (saleRows ?? []).length > 0 ? (
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">
                                            Client
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Status
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Amount
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Stripe invoice
                                        </th>
                                        <th className="px-3 py-2 font-medium">
                                            Updated
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {saleRows?.map((sale) => (
                                        <tr
                                            key={sale.id}
                                            className="border-t border-neutral-800"
                                        >
                                            <td className="px-3 py-2">
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
                                            <td className="px-3 py-2">
                                                <span className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
                                                    {sale.status.replace(
                                                        /_/g,
                                                        " "
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-neutral-300">
                                                {(
                                                    sale.total_amount / 100
                                                ).toLocaleString("en-IE", {
                                                    style: "currency",
                                                    currency:
                                                        sale.currency.toUpperCase(),
                                                })}
                                            </td>
                                            <td className="px-3 py-2">
                                                {sale.stripe_hosted_invoice_url ? (
                                                    <a
                                                        href={
                                                            sale.stripe_hosted_invoice_url
                                                        }
                                                        className="text-neutral-300 underline-offset-4 hover:text-white hover:underline"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open invoice
                                                    </a>
                                                ) : sale.stripe_invoice_id ? (
                                                    <span className="font-mono text-xs text-neutral-500">
                                                        {sale.stripe_invoice_id}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-500">
                                                        Not created
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-neutral-400">
                                                {new Date(
                                                    sale.updated_at ??
                                                        sale.created_at
                                                ).toLocaleString("en-IE", {
                                                    dateStyle: "medium",
                                                    timeStyle: "short",
                                                })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="mt-4 rounded-lg bg-neutral-950 p-3 text-sm text-neutral-500">
                            No Stripe invoices created from this dashboard yet.
                        </p>
                    )}
                </section>

                <div className="mt-5 grid gap-3 md:hidden">
                    {clientSummaries.map(
                        ({
                            client,
                            assignedModuleKeys,
                            assignedServiceKeys,
                            percentage,
                            currentStep,
                            lastActivity,
                            communication,
                            stuck,
                        }) => (
                            <Link
                                key={client.id}
                                href={`/admin/client/${client.id}`}
                                className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="font-medium">
                                            {client.name ?? "Unnamed client"}
                                        </h2>

                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {client.is_test && (
                                                <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                                                    Test
                                                </span>
                                            )}

                                            {stuck && (
                                                <span className="rounded-full bg-red-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-200">
                                                    Stuck
                                                </span>
                                            )}
                                        </div>

                                        <p className="mt-1 text-sm text-neutral-300">
                                            {client.phone
                                                ? displayMessageAddress(
                                                      client.phone
                                                  )
                                                : "No phone saved"}
                                        </p>

                                        {client.email && (
                                            <p className="mt-1 text-xs text-neutral-500">
                                                {client.email}
                                            </p>
                                        )}

                                        <p className="mt-2 break-all font-mono text-xs text-neutral-500">
                                            {communication?.clickup_channel_id
                                                ? `ClickUp: ${communication.clickup_channel_id}`
                                                : "No ClickUp channel"}
                                        </p>
                                    </div>

                                    <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300">
                                        {percentage}%
                                    </span>
                                </div>

                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
                                    <div
                                        className="h-full rounded-full bg-white"
                                        style={{ width: `${percentage}%` }}
                                    />
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {assignedModuleKeys.length > 0 ? (
                                        assignedModuleKeys.map((moduleKey) => (
                                            <span
                                                key={moduleKey}
                                                className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300"
                                            >
                                                {MODULES[moduleKey]?.title ??
                                                    moduleKey}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-sm text-neutral-500">
                                            No modules
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {assignedServiceKeys.length > 0 ? (
                                        assignedServiceKeys.map((serviceKey) => (
                                            <span
                                                key={serviceKey}
                                                className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-200"
                                            >
                                                {SERVICES[serviceKey]?.title ??
                                                    serviceKey}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-sm text-neutral-500">
                                            No services
                                        </span>
                                    )}
                                </div>

                                <div className="mt-4 grid gap-3 text-sm">
                                    <div>
                                        <p className="text-neutral-500">
                                            Current step
                                        </p>
                                        <p className="mt-1 text-neutral-200">
                                            {currentStep.title}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-neutral-500">
                                            Last activity
                                        </p>
                                        <p className="mt-1 text-neutral-200">
                                            {lastActivity
                                                ? new Date(
                                                      lastActivity
                                                  ).toLocaleString("en-IE", {
                                                      dateStyle: "medium",
                                                      timeStyle: "short",
                                                  })
                                                : "No activity yet"}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        )
                    )}
                </div>

                <div className="mt-5 hidden overflow-hidden rounded-lg border border-neutral-800 md:block">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-3 py-2 font-medium">
                                    Client
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Contact
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    ClickUp channel
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Modules
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Services
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Progress
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Current step
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Last activity
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {clientSummaries.map(
                                ({
                                    client,
                                    assignedModuleKeys,
                                    assignedServiceKeys,
                                    percentage,
                                    currentStep,
                                    lastActivity,
                                    communication,
                                    stuck,
                                }) => (
                                    <tr
                                        key={client.id}
                                        className="border-t border-neutral-800 hover:bg-neutral-900/70"
                                    >
                                        <td className="px-3 py-3">
                                            <Link
                                                href={`/admin/client/${client.id}`}
                                                className="font-medium text-white underline-offset-4 hover:underline"
                                            >
                                                {client.name ??
                                                    "Unnamed client"}
                                            </Link>

                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {client.is_test && (
                                                    <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                                        Test
                                                    </span>
                                                )}

                                                {stuck && (
                                                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
                                                        Stuck
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-3 py-3">
                                            <p className="text-neutral-300">
                                                {client.phone
                                                    ? displayMessageAddress(
                                                          client.phone
                                                      )
                                                    : "No phone saved"}
                                            </p>

                                            {client.email && (
                                                <p className="mt-1 text-xs text-neutral-500">
                                                    {client.email}
                                                </p>
                                            )}
                                        </td>

                                        <td className="px-3 py-3">
                                            {communication?.clickup_channel_id ? (
                                                <div>
                                                    <p className="break-all font-mono text-xs text-neutral-300">
                                                        {
                                                            communication.clickup_channel_id
                                                        }
                                                    </p>

                                                    <p
                                                        className={`mt-1 text-xs ${
                                                            communication.is_active
                                                                ? "text-green-300"
                                                                : "text-neutral-500"
                                                        }`}
                                                    >
                                                        {communication.is_active
                                                            ? "Active"
                                                            : "Inactive"}
                                                    </p>
                                                </div>
                                            ) : (
                                                <span className="text-neutral-500">
                                                    Not created
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-3 py-3">
                                            <div className="flex flex-wrap gap-2">
                                                {assignedModuleKeys.length >
                                                0 ? (
                                                    assignedModuleKeys.map(
                                                        (moduleKey) => (
                                                            <span
                                                                key={moduleKey}
                                                                className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                                                            >
                                                                {MODULES[
                                                                    moduleKey
                                                                ]?.title ??
                                                                    moduleKey}
                                                            </span>
                                                        )
                                                    )
                                                ) : (
                                                    <span className="text-neutral-500">
                                                        No modules
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-3 py-3">
                                            <div className="flex flex-wrap gap-2">
                                                {assignedServiceKeys.length >
                                                0 ? (
                                                    assignedServiceKeys.map(
                                                        (serviceKey) => (
                                                            <span
                                                                key={serviceKey}
                                                                className="rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-200"
                                                            >
                                                                {SERVICES[
                                                                    serviceKey
                                                                ]?.title ??
                                                                    serviceKey}
                                                            </span>
                                                        )
                                                    )
                                                ) : (
                                                    <span className="text-neutral-500">
                                                        No services
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-800">
                                                    <div
                                                        className="h-full rounded-full bg-white"
                                                        style={{
                                                            width: `${percentage}%`,
                                                        }}
                                                    />
                                                </div>

                                                <span className="text-neutral-300">
                                                    {percentage}%
                                                </span>
                                            </div>
                                        </td>

                                        <td className="px-3 py-3 text-neutral-300">
                                            {currentStep.title}
                                        </td>

                                        <td className="px-3 py-3 text-neutral-400">
                                            {lastActivity
                                                ? new Date(
                                                      lastActivity
                                                  ).toLocaleString("en-IE", {
                                                      dateStyle: "medium",
                                                      timeStyle: "short",
                                                  })
                                                : "No activity yet"}
                                        </td>
                                    </tr>
                                )
                            )}
                        </tbody>
                    </table>
                </div>

                <details className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Unmatched bridge diagnostics
                    </summary>

                    <p className="mt-2 text-sm text-neutral-400">
                        Webhook events that reached the app but were not
                        attached to a client.
                    </p>

                    <div className="mt-4 grid gap-2">
                        {(diagnosticRows ?? []).length > 0 ? (
                            diagnosticRows?.map((message) => (
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
                                        ).toLocaleString("en-IE", {
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
                </details>
            </div>
        </main>
    )
}
