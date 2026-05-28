import { supabaseAdmin } from "@/lib/supabase/admin"
import { ONBOARDING_STEPS } from "@/lib/onboarding/steps"

export default async function AdminPage() {
    const { data: clients, error: clientsError } = await supabaseAdmin
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false })

    const { data: progressRows, error: progressError } = await supabaseAdmin
        .from("client_progress")
        .select("*")

    if (clientsError || progressError) {
        return (
            <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
                <p>Could not load admin dashboard.</p>
            </main>
        )
    }

    const progressByClient = new Map<string, string[]>()

    for (const row of progressRows ?? []) {
        const existing = progressByClient.get(row.client_id) ?? []
        existing.push(row.step_key)
        progressByClient.set(row.client_id, existing)
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
                                    Progress
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Current step
                                </th>
                                <th className="px-4 py-3 font-medium">
                                    Token
                                </th>
                            </tr>
                        </thead>

                        <tbody>
                            {(clients ?? []).map((client) => {
                                const completedKeys =
                                    progressByClient.get(client.id) ?? []

                                const currentStep =
                                    ONBOARDING_STEPS.find(
                                        (step) =>
                                            !completedKeys.includes(step.key)
                                    ) ??
                                    ONBOARDING_STEPS[
                                        ONBOARDING_STEPS.length - 1
                                    ]

                                const percentage = Math.round(
                                    (completedKeys.length /
                                        ONBOARDING_STEPS.length) *
                                        100
                                )

                                return (
                                    <tr
                                        key={client.id}
                                        className="border-t border-neutral-800"
                                    >
                                        <td className="px-4 py-4">
                                            {client.name ?? "Unnamed client"}
                                        </td>

                                        <td className="px-4 py-4 text-neutral-300">
                                            {client.email}
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

                                        <td className="max-w-xs truncate px-4 py-4 font-mono text-xs text-neutral-500">
                                            {client.session_token}
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