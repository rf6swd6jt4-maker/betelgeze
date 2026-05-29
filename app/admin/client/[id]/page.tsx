import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { CopyLinkButton } from "./CopyLinkButton"
import {
    archiveClient,
    deleteClient,
    updateClientModules,
} from "./actions"

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
    const cookieStore = await cookies()
    const adminSession = cookieStore.get("admin_session")?.value

    if (adminSession !== process.env.ADMIN_SESSION_SECRET) {
        redirect("/admin/login")
    }

    const { id } = await params

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("*")
        .eq("id", id)
        .single()

    if (!client) {
        return (
            <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
                <p>Client not found.</p>
            </main>
        )
    }

    const { data: moduleRows } = await supabaseAdmin
        .from("client_modules")
        .select("*")
        .eq("client_id", client.id)

    const { data: progressRows } = await supabaseAdmin
        .from("client_progress")
        .select("*")
        .eq("client_id", client.id)

    const assignedModuleKeys = moduleRows?.map((row) => row.module_key) ?? []
    const completedKeys = new Set(
        progressRows?.map((row) => row.step_key) ?? []
    )

    const moduleSteps = assignedModuleKeys.flatMap((moduleKey) => {
        const module = MODULES[moduleKey]

        if (!module) return []

        return module.steps.map((step) => ({
            ...step,
            moduleTitle: module.title,
        }))
    })

    const steps = [...BASE_STEPS, ...moduleSteps]

    const completedCount = steps.filter((step) =>
        completedKeys.has(step.key)
    ).length

    const percentage =
        steps.length === 0
            ? 100
            : Math.round((completedCount / steps.length) * 100)

    const latestActivity = progressRows?.reduce<string | null>((latest, row) => {
        const rowDate = row.completed_at ?? row.created_at

        if (!rowDate) return latest
        if (!latest) return rowDate

        return new Date(rowDate) > new Date(latest) ? rowDate : latest
    }, null)

    const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

    const onboardingUrl = `${baseUrl}/session/${client.session_token}`

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
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

                    <div className="flex flex-wrap gap-3">
                        <Link
                            href={`/session/${client.session_token}`}
                            className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-black"
                        >
                            Open onboarding
                        </Link>

                        <CopyLinkButton url={onboardingUrl} />
                    </div>
                </div>

                <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                    <p className="text-sm font-medium text-neutral-300">
                        Onboarding link
                    </p>

                    <p className="mt-3 break-all font-mono text-xs text-neutral-500">
                        {onboardingUrl}
                    </p>
                </div>

                <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
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
                        {completedCount} of {steps.length} steps completed ·{" "}
                        {percentage}%
                    </p>
                </div>

                <form
                    action={async (formData) => {
                        "use server"
                        await updateClientModules(client.id, formData)
                    }}
                    className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
                >
                    <p className="text-sm font-medium text-neutral-300">
                        Assigned modules
                    </p>

                    <div className="mt-4 space-y-3">
                        {Object.values(MODULES).map((module) => (
                            <label
                                key={module.key}
                                className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                            >
                                <input
                                    type="checkbox"
                                    name="modules"
                                    value={module.key}
                                    defaultChecked={assignedModuleKeys.includes(
                                        module.key
                                    )}
                                    className="mt-1"
                                />

                                <span>
                                    <span className="block font-medium">
                                        {module.title}
                                    </span>

                                    <span className="mt-1 block text-sm text-neutral-500">
                                        {module.steps.length} onboarding steps
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>

                    <button className="mt-6 rounded-xl bg-white px-4 py-3 text-sm font-medium text-black">
                        Save modules
                    </button>
                </form>

                <div className="mt-8 overflow-hidden rounded-2xl border border-neutral-800">
                    <table className="w-full border-collapse text-left text-sm">
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

                    <div className="mt-5 flex flex-wrap gap-3">
                        <form
                            action={async () => {
                                "use server"
                                await archiveClient(client.id)
                            }}
                        >
                            <button className="rounded-xl border border-red-500/40 px-4 py-3 text-sm font-medium text-red-200">
                                Archive client
                            </button>
                        </form>

                        <form
                            action={async () => {
                                "use server"
                                await deleteClient(client.id)
                            }}
                        >
                            <button className="rounded-xl bg-red-500 px-4 py-3 text-sm font-medium text-white">
                                Delete client permanently
                            </button>
                        </form>
                    </div>
                </div>

                <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                    <p className="text-sm font-medium text-neutral-300">
                        Session token
                    </p>

                    <p className="mt-3 break-all font-mono text-xs text-neutral-500">
                        {client.session_token}
                    </p>
                </div>
            </div>
        </main>
    )
}