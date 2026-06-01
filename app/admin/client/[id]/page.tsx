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
import { FormResponsesSummary } from "@/components/admin/FormResponsesSummary"
import { ClientActionsMenu } from "./ClientActionsMenu"
import {
    addClientNote,
    archiveClient,
    clearClientProgress,
    deleteClient,
} from "./actions"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{
        id: string
    }>
}

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
        moduleTitle: "General",
    },
]

export default async function ClientDetailPage({ params }: PageProps) {
    await requireAdmin()

    const { id } = await params

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name, email, session_token, created_at, archived_at")
        .eq("id", id)
        .single()

    if (!client) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Client not found.</p>
            </main>
        )
    }

    const [
        { data: moduleRows },
        { data: progressRows },
        { data: noteRows },
        { data: activityRows },
        { data: formResponseRows },
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
        <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white sm:px-6 sm:py-10">
            <div className="mx-auto max-w-5xl">
                <Link href="/admin" className="text-sm text-neutral-400">
                    ← Back to dashboard
                </Link>

                <div className="mt-8 flex flex-col justify-between gap-6 md:flex-row md:items-start">
                    <div>
                        <p className="text-sm text-neutral-400">
                            Client details
                        </p>

                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                            {client.name ?? "Unnamed client"}
                        </h1>

                        <p className="mt-2 text-neutral-400">
                            {client.email}
                        </p>

                        <p className="mt-2 text-sm text-neutral-500">
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
                            className="rounded-xl bg-white px-4 py-3 text-center text-sm font-medium text-black"
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

                <div className="mt-8 grid gap-6 lg:grid-cols-3">
                    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 lg:col-span-2">
                        <p className="text-sm font-medium text-neutral-300">
                            Progress
                        </p>

                        <div className="mt-4 h-3 overflow-hidden rounded-full bg-neutral-800">
                            <div
                                className="h-full rounded-full bg-white"
                                style={{ width: `${percentage}%` }}
                            />
                        </div>

                        <p className="mt-3 text-sm text-neutral-400">
                            {completedCount} of {steps.length} steps completed
                            · {percentage}%
                        </p>
                    </section>

                    <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                        <p className="text-sm font-medium text-neutral-300">
                            Assigned modules
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {assignedModuleKeys.length > 0 ? (
                                assignedModuleKeys.map((moduleKey) => (
                                    <span
                                        key={moduleKey}
                                        className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300"
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

                <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                    <p className="text-sm font-medium text-neutral-300">
                        Onboarding link
                    </p>

                    <p className="mt-3 break-all font-mono text-xs text-neutral-500">
                        {onboardingUrl}
                    </p>
                </section>

                <section className="mt-8 grid gap-6 lg:grid-cols-2">
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                        <p className="text-sm font-medium text-neutral-300">
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
                                className="min-h-28 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none"
                            />

                            <button className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black">
                                Add note
                            </button>
                        </form>

                        <div className="mt-6 space-y-3">
                            {(noteRows ?? []).length > 0 ? (
                                noteRows?.map((note) => (
                                    <div
                                        key={note.id}
                                        className="rounded-xl bg-neutral-950 p-4"
                                    >
                                        <p className="whitespace-pre-wrap text-sm text-neutral-200">
                                            {note.note}
                                        </p>

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

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                        <p className="text-sm font-medium text-neutral-300">
                            Timeline
                        </p>

                        <div className="mt-6 space-y-4">
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

                <div className="mt-8 overflow-x-auto rounded-2xl border border-neutral-800">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                        <thead className="bg-neutral-900 text-neutral-400">
                            <tr>
                                <th className="px-4 py-3 font-medium">
                                    Status
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Module
                                </th>
                                <th className="px-4 py-3 font-medium">
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
                                        <td className="px-4 py-4">
                                            {complete ? (
                                                <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-300">
                                                    Complete
                                                </span>
                                            ) : (
                                                <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-400">
                                                    Pending
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-4 py-4 text-neutral-300">
                                            {step.moduleTitle}
                                        </td>

                                        <td className="px-4 py-4">
                                            {step.title}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="mt-8 rounded-2xl border border-red-900/60 bg-red-950/30 p-6">
                    <p className="text-sm font-medium text-red-200">
                        Danger zone
                    </p>

                    <p className="mt-2 text-sm text-red-200/70">
                        Archive hides the client from the dashboard but keeps
                        their records. Delete permanently removes the client and
                        their related onboarding data.
                    </p>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <form
                            action={async () => {
                                "use server"
                                await archiveClient(client.id)
                            }}
                        >
                            <button className="w-full rounded-xl border border-red-500/40 px-4 py-3 text-sm font-medium text-red-200 sm:w-auto">
                                Archive client
                            </button>
                        </form>

                        <form
                            action={async () => {
                                "use server"
                                await deleteClient(client.id)
                            }}
                        >
                            <button className="w-full rounded-xl bg-red-500 px-4 py-3 text-sm font-medium text-white sm:w-auto">
                                Delete client permanently
                            </button>
                        </form>
                    </div>
                </div>

                <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                    <p className="text-sm font-medium text-neutral-300">
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
