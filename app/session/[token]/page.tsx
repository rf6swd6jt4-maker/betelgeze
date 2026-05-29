import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { completeStep } from "./actions"

type PageProps = {
    params: Promise<{
        token: string
    }>
}

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
        description: "Watch this short welcome video before starting.",
        moduleTitle: "General",
    },
]

const FINAL_STEP = {
    key: "final",
    title: "All done",
    description: "You have completed the core onboarding steps.",
    moduleTitle: "General",
}

export default async function SessionPage({ params }: PageProps) {
    const { token } = await params

    const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("*")
        .eq("session_token", token)
        .single()

    if (error || !client) {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
                <p>Invalid onboarding link.</p>
            </main>
        )
    }

    const { data: clientModules } = await supabaseAdmin
        .from("client_modules")
        .select("module_key")
        .eq("client_id", client.id)

    const moduleSteps =
        clientModules?.flatMap((row) => {
            const module = MODULES[row.module_key]

            if (!module) return []

            return module.steps.map((step) => ({
                ...step,
                moduleTitle: module.title,
            }))
        }) ?? []

    const completableSteps = [...BASE_STEPS, ...moduleSteps]
    const steps = [...completableSteps, FINAL_STEP]

    const { data: progressRows } = await supabaseAdmin
        .from("client_progress")
        .select("step_key")
        .eq("client_id", client.id)

    const completedKeys = new Set(
        progressRows?.map((row) => row.step_key) ?? []
    )

    const completedCount = completableSteps.filter((step) =>
        completedKeys.has(step.key)
    ).length

    const allCompletableStepsDone = completedCount === completableSteps.length

    const currentStep =
        completableSteps.find((step) => !completedKeys.has(step.key)) ??
        FINAL_STEP

    const isFinalStep = currentStep.key === "final"

    const percentage =
        completableSteps.length === 0
            ? 100
            : Math.round((completedCount / completableSteps.length) * 100)

    const currentStepNumber = isFinalStep
        ? completableSteps.length
        : completableSteps.findIndex((step) => step.key === currentStep.key) + 1

    return (
        <main className="min-h-screen bg-neutral-950 text-white px-5 py-10">
            <div className="mx-auto max-w-xl">
                <p className="text-sm text-neutral-400">
                    Welcome, {client.name}
                </p>

                <div className="mt-6 h-2 overflow-hidden rounded-full bg-neutral-800">
                    <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{ width: `${percentage}%` }}
                    />
                </div>

                <p className="mt-3 text-xs text-neutral-500">
                    {isFinalStep
                        ? `Complete · ${percentage}% complete`
                        : `Step ${currentStepNumber} of ${completableSteps.length} · ${percentage}% complete`}
                </p>

                <p className="mt-8 text-sm font-medium text-neutral-400">
                    {currentStep.moduleTitle}
                </p>

                <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                    {currentStep.title}
                </h1>

                <p className="mt-4 text-neutral-300">
                    {currentStep.description}
                </p>

                {isFinalStep ? (
                    <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-4 text-green-200">
                        Onboarding complete.
                    </div>
                ) : (
                    <form
                        action={async () => {
                            "use server"
                            await completeStep(token, currentStep.key)
                        }}
                    >
                        <button className="mt-8 w-full rounded-xl bg-white px-5 py-4 font-medium text-black">
                            Complete and continue
                        </button>
                    </form>
                )}

                <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                    <p className="text-sm font-medium">Assigned modules</p>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {clientModules && clientModules.length > 0 ? (
                            clientModules.map((row) => {
                                const module = MODULES[row.module_key]

                                return (
                                    <span
                                        key={row.module_key}
                                        className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-neutral-300"
                                    >
                                        {module?.title ?? row.module_key}
                                    </span>
                                )
                            })
                        ) : (
                            <span className="text-sm text-neutral-500">
                                No modules assigned.
                            </span>
                        )}
                    </div>
                </div>

                <p className="mt-6 text-sm text-neutral-500">
                    Client email: {client.email}
                </p>
            </div>
        </main>
    )
}