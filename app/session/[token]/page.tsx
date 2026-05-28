import { supabaseAdmin } from "@/lib/supabase/admin"
import { ONBOARDING_STEPS } from "@/lib/onboarding/steps"
import { completeStep } from "./actions"

type PageProps = {
    params: Promise<{
        token: string
    }>
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

    const { data: progressRows } = await supabaseAdmin
        .from("client_progress")
        .select("step_key")
        .eq("client_id", client.id)

    const completedKeys = new Set(
        progressRows?.map((row) => row.step_key) ?? []
    )

    const currentStep =
        ONBOARDING_STEPS.find((step) => !completedKeys.has(step.key)) ??
        ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]

    const currentIndex = ONBOARDING_STEPS.findIndex(
        (step) => step.key === currentStep.key
    )

    const isFinalStep = currentStep.key === "final"
    const completedCount = Math.min(completedKeys.size, ONBOARDING_STEPS.length)

    return (
        <main className="min-h-screen bg-neutral-950 text-white px-5 py-10">
            <div className="mx-auto max-w-xl">
                <p className="text-sm text-neutral-400">
                    Welcome, {client.name}
                </p>

                <div className="mt-6 h-2 overflow-hidden rounded-full bg-neutral-800">
                    <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{
                            width: `${(completedCount / ONBOARDING_STEPS.length) * 100}%`,
                        }}
                    />
                </div>

                <p className="mt-3 text-xs text-neutral-500">
                    Step {currentIndex + 1} of {ONBOARDING_STEPS.length}
                </p>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    {currentStep.title}
                </h1>

                <p className="mt-4 text-neutral-300">
                    {currentStep.description}
                </p>

                {currentStep.videoUrl && (
                    <div className="mt-8 aspect-video overflow-hidden rounded-2xl bg-neutral-800">
                        <iframe
                            src={currentStep.videoUrl}
                            allowFullScreen
                            className="h-full w-full"
                        />
                    </div>
                )}

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

                <p className="mt-6 text-sm text-neutral-500">
                    Client email: {client.email}
                </p>
            </div>
        </main>
    )
}