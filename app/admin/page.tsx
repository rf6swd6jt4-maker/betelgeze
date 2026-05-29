import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
    },
]

export default async function AdminPage() {
    const cookieStore = await cookies()
    const adminSession = cookieStore.get("admin_session")?.value

    if (adminSession !== process.env.ADMIN_SESSION_SECRET) {
        redirect("/admin/login")
    }

    const { data: clients, error: clientsError } = await supabaseAdmin
        .from("clients")
        .select("*")
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    const { data: progressRows, error: progressError } = await supabaseAdmin
        .from("client_progress")
        .select("*")

    const { data: moduleRows, error: modulesError } = await supabaseAdmin
        .from("client_modules")
        .select("*")

    if (clientsError || progressError || modulesError) {
        return (
            <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
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

    for (const row of moduleRows ?? []) {
        const existing = modulesByClient.get(row.client_id) ?? []
        existing.push(row.module_key)
        modulesByClient.set(row.client_id, existing)
    }

    return (
        <main className="min-h-screen bg-neutral-950 text-white px-6 py-10">
            <div className="mx-auto max-w-6xl">
                <p className="text-sm text-neutral-400">Agency Onboarding</p>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight">
                    Admin dashboard
                </h1>

                <p className="mt-3 text-neutral-400">
                    Track client onboarding progress from one place.
                </p>

                <Link
                    href="/admin/new"
                    className="mt-6 inline-flex rounded-xl bg-white px-4 py-3 text-sm font-medium text-black"
                >
                    Add client
                </Link>

                <div className="mt-8 overflow-hidden rounded-2xl border border-neutral-800">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead className="bg-neutral-900 text-neutral-400">
                            <tr>
                                <th className="px-4 py-3 font-medium">
                                    Client
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Email
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Modules
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Progress
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Current step
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Last activity
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {(clients ?? []).map((client) => {
                                const completedKeys =
                                    progressByClient.get(client.id) ?? []

                                const assignedModuleKeys =
                                    modulesByClient.get(client.id) ?? []

                                const moduleSteps = assignedModuleKeys.flatMap(
                                    (moduleKey) => {
                                        const module = MODULES[moduleKey]

                                        if (!module) {
                                            return []
                                        }

                                        return module.steps.map((step) => ({
                                            ...step,
                                            moduleTitle: module.title,
                                        }))
                                    }
                                )

                                const completableSteps = [
                                    ...BASE_STEPS,
                                    ...moduleSteps,
                                ]

                                const completedCount = completableSteps.filter(
                                    (step) => completedKeys.includes(step.key)
                                ).length

                                const percentage =
                                    completableSteps.length === 0
                                        ? 100
                                        : Math.round(
                                              (completedCount /
                                                  completableSteps.length) *
                                                  100
                                          )

                                const currentStep =
                                    completableSteps.find(
                                        (step) =>
                                            !completedKeys.includes(step.key)
                                    ) ?? {
                                        key: "final",
                                        title: "Complete",
                                        moduleTitle: "General",
                                    }

                                const lastActivity =
                                    activityByClient.get(client.id)

                                return (
                                    <tr
                                        key={client.id}
                                        className="border-t border-neutral-800"
                                    >
                                        <td className="px-4 py-4">
                                            <Link
                                                href={`/admin/client/${client.id}`}
                                                className="font-medium underline underline-offset-4"
                                            >
                                                {client.name ??
                                                    "Unnamed client"}
                                            </Link>
                                        </td>

                                        <td className="px-4 py-4 text-neutral-300">
                                            {client.email}
                                        </td>

                                        <td className="px-4 py-4">
                                            <div className="flex flex-wrap gap-2">
                                                {assignedModuleKeys.length >
                                                0 ? (
                                                    assignedModuleKeys.map(
                                                        (moduleKey) => (
                                                            <span
                                                                key={moduleKey}
                                                                className="rounded-full bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300"
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

                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
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

                                        <td className="px-4 py-4 text-neutral-300">
                                            {currentStep.title}
                                        </td>

                                        <td className="px-4 py-4 text-neutral-400">
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
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    )
}