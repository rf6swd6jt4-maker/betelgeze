import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { requireAdmin } from "@/lib/admin/auth"
import {
    FormResponse,
    getOnboardingForm,
    OnboardingFormDefinition,
} from "@/lib/onboarding/forms"
import {
    getCompletedStepCount,
    getProgressPercentage,
} from "@/lib/onboarding/progress"
import { maskToken } from "@/lib/security/tokens"
import { displayMessageAddress } from "@/lib/client-messages/addresses"
import { AdminCopyButton } from "@/components/admin/AdminCopyButton"
import { FormResponsesSummary } from "@/components/admin/FormResponsesSummary"
import { ClientActionsMenu } from "./ClientActionsMenu"
import {
    addClientNote,
    archiveClient,
    clearClientProgress,
    deleteClientNote,
    deleteClient,
    updateClientCommunication,
    createClientClickUpChannel,
    checkClickUpConnection,
} from "./actions"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{
        id: string
    }>
    searchParams: Promise<{
        bridgeError?: string
        deleteError?: string
    }>
}

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
        moduleTitle: "General",
    },
]

export default async function ClientDetailPage({
    params,
    searchParams,
}: PageProps) {
    await requireAdmin()

    const { id } = await params
    const { bridgeError, deleteError } = await searchParams

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name, email, phone, session_token, created_at, archived_at")
        .eq("id", id)
        .single()

    if (!client) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Client not found.</p>
            </main>
        )
    }

    const messageRowsQuery = supabaseAdmin
        .from("client_messages")
        .select(
            "id, direction, provider, from_address, to_address, body, status, error, created_at"
        )
        .or(
            [
                `client_id.eq.${client.id}`,
                client.phone ? `from_address.eq.${client.phone}` : null,
                client.phone ? `to_address.eq.${client.phone}` : null,
            ]
                .filter(Boolean)
                .join(",")
        )
        .order("created_at", { ascending: false })
        .limit(8)

    const [
        { data: moduleRows },
        { data: progressRows },
        { data: noteRows },
        { data: activityRows },
        { data: formResponseRows },
        { data: communicationChannel },
        { data: messageRows },
    ] = await Promise.all([
        supabaseAdmin
            .from("client_modules")
            .select("id, client_id, module_key")
            .eq("client_id", client.id),
        supabaseAdmin
            .from("client_progress")
            .select("id, client_id, step_key, completed_at, created_at")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false }),
        supabaseAdmin
            .from("client_notes")
            .select("id, client_id, note, created_at")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false }),
        supabaseAdmin
            .from("client_activity")
            .select("id, client_id, activity_type, activity_text, created_at")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false }),
        supabaseAdmin
            .from("client_form_responses")
            .select("step_key, response, updated_at")
            .eq("client_id", client.id)
            .order("updated_at", { ascending: false }),
        supabaseAdmin
            .from("client_communication_channels")
            .select(
                "id, external_address, clickup_workspace_id, clickup_space_id, clickup_channel_id, is_active, updated_at"
            )
            .eq("client_id", client.id)
            .maybeSingle(),
        messageRowsQuery,
    ])

    const assignedModuleKeys = moduleRows?.map((row) => row.module_key) ?? []
    const completedKeys = new Set(
        progressRows?.map((row) => row.step_key) ?? []
    )

    const moduleSteps = assignedModuleKeys.flatMap((moduleKey) => {
        const moduleDefinition = MODULES[moduleKey]

        if (!moduleDefinition) return []

        return moduleDefinition.steps.map((step) => ({
            ...step,
            moduleTitle: moduleDefinition.title,
        }))
    })

    const steps = [...BASE_STEPS, ...moduleSteps]
    const formsByStep: Record<string, OnboardingFormDefinition> = {}

    for (const step of moduleSteps) {
        const form = step.formKey ? getOnboardingForm(step.formKey) : null

        if (form) {
            formsByStep[step.key] = form
        }
    }

    const completedCount = getCompletedStepCount(steps, completedKeys)

    const percentage = getProgressPercentage(steps, completedKeys)

    const progressDates =
        progressRows
            ?.map((row) => row.completed_at ?? row.created_at)
            .filter(Boolean) ?? []

    const latestProgressActivity =
        progressDates.length > 0
            ? progressDates.sort(
                  (a, b) => new Date(b).getTime() - new Date(a).getTime()
              )[0]
            : null

    const latestAdminActivity = activityRows?.[0]?.created_at ?? null

    const latestActivity =
        latestProgressActivity && latestAdminActivity
            ? new Date(latestProgressActivity) > new Date(latestAdminActivity)
                ? latestProgressActivity
                : latestAdminActivity
            : latestProgressActivity ?? latestAdminActivity

    const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

    const onboardingPath = `/session/${client.session_token}`
    const onboardingUrl = `${baseUrl}${onboardingPath}`

    const timelineItems = [
        ...(progressRows ?? []).map((row) => {
            const step = steps.find((item) => item.key === row.step_key)

            return {
                id: `progress-${row.id}`,
                date: row.completed_at ?? row.created_at,
                label: `Completed ${step?.title ?? row.step_key}`,
                type: "progress",
            }
        }),
        ...(activityRows ?? []).map((row) => ({
            id: `activity-${row.id}`,
            date: row.created_at,
            label: row.activity_text,
            type: row.activity_type,
        })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <Link
                    href="/admin"
                    className="text-sm text-neutral-400 hover:text-white"
                >
                    ← Back to dashboard
                </Link>

                <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Client details
                        </p>

                        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                            {client.name ?? "Unnamed client"}
                        </h1>

                        <p className="mt-1 text-sm text-neutral-300">
                            {client.phone
                                ? displayMessageAddress(client.phone)
                                : "No phone saved"}
                        </p>

                        {client.email && (
                            <p className="mt-1 text-xs text-neutral-500">
                                {client.email}
                            </p>
                        )}

                        <p className="mt-1 text-xs text-neutral-500">
                            Last activity:{" "}
                            {latestActivity
                                ? new Date(latestActivity).toLocaleString(
                                      "en-IE",
                                      {
                                          dateStyle: "medium",
                                          timeStyle: "short",
                                      }
                                  )
                                : "No activity yet"}
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <Link
                            href={`/admin/client/${client.id}/edit`}
                            className="rounded-lg bg-white px-3 py-2 text-center text-sm font-medium text-black"
                        >
                            Edit client
                        </Link>

                        <ClientActionsMenu
                            onboardingPath={onboardingPath}
                            onboardingUrl={onboardingUrl}
                            clearProgressAction={async () => {
                                "use server"
                                await clearClientProgress(client.id)
                            }}
                        />
                    </div>
                </div>

                {deleteError === "clickup-cleanup" && (
                    <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        Client deletion was stopped because the ClickUp Space
                        or channel could not be removed. Check the timeline for
                        the ClickUp error.
                    </div>
                )}

                <div className="mt-5 grid gap-3 lg:grid-cols-4">
                    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 lg:col-span-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Progress
                        </p>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
                            <div
                                className="h-full rounded-full bg-white"
                                style={{ width: `${percentage}%` }}
                            />
                        </div>

                        <p className="mt-2 text-sm text-neutral-400">
                            {completedCount} of {steps.length} steps completed
                            · {percentage}%
                        </p>
                    </section>

                    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 lg:col-span-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Assigned modules
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                            {assignedModuleKeys.length > 0 ? (
                                assignedModuleKeys.map((moduleKey) => (
                                    <span
                                        key={moduleKey}
                                        className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                                    >
                                        {MODULES[moduleKey]?.title ?? moduleKey}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-neutral-500">
                                    No modules assigned.
                                </span>
                            )}
                        </div>
                    </section>
                </div>

                <section className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                Onboarding link
                            </p>

                            <p className="mt-2 break-all font-mono text-xs text-neutral-400">
                                {onboardingUrl}
                            </p>
                        </div>

                        <AdminCopyButton
                            value={onboardingUrl}
                            label="Copy link"
                            className="shrink-0 rounded-md border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
                        />
                    </div>
                </section>

                <section className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                Client messages bridge
                            </p>

                            <h2 className="mt-2 text-lg font-semibold">
                                WhatsApp to ClickUp Chat
                            </h2>

                            <p className="mt-1 text-sm text-neutral-400">
                                Route this client&apos;s WhatsApp messages into their ClickUp
                                Chat channel.
                            </p>
                        </div>

                        <span
                            className={`w-fit rounded-md px-2 py-1 text-xs ${
                                communicationChannel?.is_active
                                    ? "bg-green-500/10 text-green-300"
                                    : "bg-neutral-800 text-neutral-400"
                            }`}
                        >
                            {communicationChannel?.is_active
                                ? "Active"
                                : "Not active"}
                        </span>
                    </div>

                    {bridgeError && (
                        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                            Add both the client phone/channel address and the
                            ClickUp Chat channel ID.
                        </div>
                    )}

                    <form
                        action={async (formData) => {
                            "use server"
                            await updateClientCommunication(
                                client.id,
                                formData
                            )
                        }}
                        className="mt-4 grid gap-3 md:grid-cols-2"
                    >
                        <label className="block text-sm text-neutral-300">
                            Client WhatsApp number
                            <input
                                name="external_address"
                                placeholder="+15551234567"
                                defaultValue={
                                    displayMessageAddress(
                                        communicationChannel?.external_address ??
                                            client.phone ??
                                            ""
                                    )
                                }
                                className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>

                        <label className="block text-sm text-neutral-300">
                            ClickUp Chat channel ID
                            <input
                                name="clickup_channel_id"
                                defaultValue={
                                    communicationChannel?.clickup_channel_id ??
                                    ""
                                }
                                className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>

                        <label className="block text-sm text-neutral-300">
                            ClickUp workspace ID override
                            <input
                                name="clickup_workspace_id"
                                placeholder="Leave blank to use CLICKUP_WORKSPACE_ID"
                                defaultValue={
                                    communicationChannel?.clickup_workspace_id ??
                                    ""
                                }
                                className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
                            />
                        </label>

                        <label className="block text-sm text-neutral-300">
                            ClickUp Space ID
                            <input
                                value={
                                    communicationChannel?.clickup_space_id ??
                                    ""
                                }
                                readOnly
                                placeholder="Created automatically"
                                className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-400 outline-none"
                            />
                        </label>

                        <div className="flex items-end justify-between gap-3">
                            <label className="flex items-center gap-2 text-sm text-neutral-300">
                                <input
                                    type="checkbox"
                                    name="is_active"
                                    defaultChecked={
                                        communicationChannel?.is_active ?? true
                                    }
                                />
                                Active bridge
                            </label>

                            <button className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">
                                Save bridge
                            </button>
                        </div>
                    </form>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <form
                            action={async () => {
                                "use server"
                                await checkClickUpConnection(client.id)
                            }}
                        >
                            <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white">
                                Check ClickUp connection
                            </button>
                        </form>

                        <form
                            action={async () => {
                                "use server"
                                await createClientClickUpChannel(client.id)
                            }}
                        >
                            <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white">
                                {communicationChannel?.clickup_channel_id
                                    ? "Refresh ClickUp Chat channel"
                                    : "Create ClickUp Chat channel"}
                            </button>
                        </form>
                    </div>

                    <div className="mt-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Recent bridged messages
                        </p>

                        <div className="mt-3 space-y-2">
                            {(messageRows ?? []).length > 0 ? (
                                messageRows?.map((message) => (
                                    <div
                                        key={message.id}
                                        className="rounded-lg bg-neutral-950 p-3"
                                    >
                                        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                                            <p className="whitespace-pre-wrap text-sm text-neutral-200">
                                                {message.body}
                                            </p>

                                            <span
                                                className={`w-fit rounded-md px-2 py-1 text-xs ${
                                                    message.status.includes(
                                                        "failed"
                                                    )
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
                                <p className="text-sm text-neutral-500">
                                    No bridged messages yet.
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                <section className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Notes
                        </p>

                        <form
                            action={async (formData) => {
                                "use server"
                                await addClientNote(client.id, formData)
                            }}
                            className="mt-4"
                        >
                            <textarea
                                name="note"
                                required
                                placeholder="Add an internal note..."
                                className="min-h-24 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
                            />

                            <button className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">
                                Add note
                            </button>
                        </form>

                        <div className="mt-4 space-y-2">
                            {(noteRows ?? []).length > 0 ? (
                                noteRows?.map((note) => (
                                    <div
                                        key={note.id}
                                        className="rounded-lg bg-neutral-950 p-3"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="whitespace-pre-wrap text-sm text-neutral-200">
                                                {note.note}
                                            </p>

                                            <form
                                                action={async () => {
                                                    "use server"
                                                    await deleteClientNote(
                                                        client.id,
                                                        note.id
                                                    )
                                                }}
                                            >
                                                <button
                                                    className="rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-500 hover:border-red-500/40 hover:bg-red-950/30 hover:text-red-200"
                                                    aria-label="Delete note"
                                                    title="Delete note"
                                                >
                                                    Delete
                                                </button>
                                            </form>
                                        </div>

                                        <p className="mt-3 text-xs text-neutral-500">
                                            {new Date(
                                                note.created_at
                                            ).toLocaleString("en-IE", {
                                                dateStyle: "medium",
                                                timeStyle: "short",
                                            })}
                                        </p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-neutral-500">
                                    No notes yet.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Timeline
                        </p>

                        <div className="mt-4 space-y-3">
                            {timelineItems.length > 0 ? (
                                timelineItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className="border-l border-neutral-700 pl-4"
                                    >
                                        <p className="text-sm text-neutral-200">
                                            {item.label}
                                        </p>

                                        <p className="mt-1 text-xs text-neutral-500">
                                            {new Date(item.date).toLocaleString(
                                                "en-IE",
                                                {
                                                    dateStyle: "medium",
                                                    timeStyle: "short",
                                                }
                                            )}
                                        </p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-neutral-500">
                                    No activity yet.
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                <FormResponsesSummary
                    responses={(formResponseRows ?? []).map((row) => ({
                        step_key: row.step_key,
                        response: row.response as FormResponse,
                        updated_at: row.updated_at,
                    }))}
                    formsByStep={formsByStep}
                />

                <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-800">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                        <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-3 py-2 font-medium">
                                    Status
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Module
                                </th>
                                <th className="px-3 py-2 font-medium">
                                    Step
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {steps.map((step) => {
                                const complete = completedKeys.has(step.key)

                                return (
                                    <tr
                                        key={step.key}
                                        className="border-t border-neutral-800"
                                    >
                                        <td className="px-3 py-2">
                                            {complete ? (
                                                <span className="rounded-md bg-green-500/10 px-2 py-1 text-xs text-green-300">
                                                    Complete
                                                </span>
                                            ) : (
                                                <span className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-400">
                                                    Pending
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-3 py-2 text-neutral-300">
                                            {step.moduleTitle}
                                        </td>

                                        <td className="px-3 py-2">
                                            {step.title}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
                    <p className="text-sm font-medium text-red-200">
                        Danger zone
                    </p>

                    <p className="mt-2 text-sm text-red-200/70">
                        Archive hides the client from the dashboard but keeps
                        their records. Delete permanently removes the client and
                        their related onboarding data.
                    </p>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <form
                            action={async () => {
                                "use server"
                                await archiveClient(client.id)
                            }}
                        >
                            <button className="w-full rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-200 sm:w-auto">
                                Archive client
                            </button>
                        </form>

                        <form
                            action={async () => {
                                "use server"
                                await deleteClient(client.id)
                            }}
                        >
                            <button className="w-full rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white sm:w-auto">
                                Delete client permanently
                            </button>
                        </form>
                    </div>
                </div>

                <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Session token
                    </p>

                    <p className="mt-3 font-mono text-xs text-neutral-500">
                        {maskToken(client.session_token)}
                    </p>
                </div>
            </div>
        </main>
    )
}
