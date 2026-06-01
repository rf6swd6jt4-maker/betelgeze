import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES, StepKind } from "@/lib/onboarding/modules"
import { completeStep } from "./actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import { ScrollToTopOnStepChange } from "@/components/onboarding/ScrollToTopOnStepChange"
import { FormPlaceholder } from "@/components/onboarding/FormPlaceholder"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{
        token: string
    }>
}

type SessionStep = {
    key: string
    title: string
    description: string
    moduleTitle: string
    estimatedTime: string
    why: string
    kind: StepKind | "final"
    formKey?: string
    videoUrl?: string
}

const BASE_STEPS: SessionStep[] = [
    {
        key: "welcome-video",
        title: "Welcome",
        description:
            "We’ll explain how this onboarding works and what we need from you.",
        moduleTitle: "General",
        estimatedTime: "2 minutes",
        why:
            "This helps us make sure you know exactly what happens next before we ask for any business details.",
        kind: "video",
        videoUrl: "",
    },
]

const FINAL_STEP: SessionStep = {
    key: "final",
    title: "All done",
    description: "You have completed the onboarding steps.",
    moduleTitle: "Finished",
    estimatedTime: "No action needed",
    why:
        "Once onboarding is complete, our team can review everything and start preparing your project properly.",
    kind: "final",
}

export default async function SessionPage({ params }: PageProps) {
    const { token } = await params

    const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("id, name, email, session_token")
        .eq("session_token", token)
        .single()

    if (error || !client) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-slate-900">
                <p>Invalid onboarding link.</p>
            </main>
        )
    }

    const { data: clientModules } = await supabaseAdmin
        .from("client_modules")
        .select("module_key")
        .eq("client_id", client.id)

    const moduleSteps: SessionStep[] =
        clientModules?.flatMap((row) => {
            const moduleDefinition = MODULES[row.module_key]

            if (!moduleDefinition) return []

            return moduleDefinition.steps.map((step) => ({
                ...step,
                moduleTitle: moduleDefinition.title,
                estimatedTime:
                    step.kind === "video" ? "2 minutes" : "2–3 minutes",
                why:
                    step.kind === "video"
                        ? "This video shows you exactly what to do, so you do not need to guess your way through account settings."
                        : "This information helps us set up your project correctly and avoid delays later.",
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

    const currentStep =
        completableSteps.find((step) => !completedKeys.has(step.key)) ??
        FINAL_STEP

    const isFinalStep = currentStep.key === "final"

    const roadmapSteps = steps.map((step) => ({
        key: step.key,
        title: step.title,
        complete:
            step.key === "final"
                ? isFinalStep
                : completedKeys.has(step.key),
        current: step.key === currentStep.key,
    }))

    const assignedModules =
        clientModules
            ?.map((row) => MODULES[row.module_key]?.title)
            .filter(Boolean) ?? []

    return (
        <OnboardingLayout roadmapSteps={roadmapSteps}>
            <ScrollToTopOnStepChange stepKey={currentStep.key} />

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <p className="text-sm font-semibold uppercase tracking-wide text-[#1E3A5F]">
                    {currentStep.moduleTitle}
                </p>

                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                    {isFinalStep ? "You’re all set" : currentStep.title}
                </h1>

                <p className="mt-4 text-lg leading-7 text-slate-600">
                    {isFinalStep
                        ? "We’ve received everything required to begin your project."
                        : currentStep.description}
                </p>

                <div className="mt-5 inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-[#1E3A5F]">
                    Estimated time: {currentStep.estimatedTime}
                </div>

                {currentStep.key === "welcome-video" && (
                    <div className="mt-8 rounded-2xl bg-[#F8F7F3] p-5">
                        <p className="font-semibold text-slate-950">
                            Your project includes:
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {assignedModules.length > 0 ? (
                                assignedModules.map((moduleTitle) => (
                                    <span
                                        key={moduleTitle}
                                        className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-[#1E3A5F]"
                                    >
                                        ✓ {moduleTitle}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-500">
                                    No services assigned yet.
                                </span>
                            )}
                        </div>

                        <p className="mt-5 text-sm text-slate-600">
                            You can leave and come back any time. Your progress
                            is saved automatically.
                        </p>
                    </div>
                )}

                {!isFinalStep && currentStep.kind === "video" && (
                    <div className="mt-8 aspect-video overflow-hidden rounded-2xl bg-[#1E3A5F]">
                        <div className="flex h-full items-center justify-center text-white">
                            Video placeholder
                        </div>
                    </div>
                )}

                {!isFinalStep && currentStep.kind === "form" && (
                    <FormPlaceholder formKey={currentStep.formKey} />
                )}

                {!isFinalStep && (
                    <div className="mt-8">
                        <WhyWeAskCard>{currentStep.why}</WhyWeAskCard>
                    </div>
                )}

                {isFinalStep ? (
                    <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900">
                        <p className="font-semibold">What happens next?</p>

                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                            <li>Our team reviews your information.</li>
                            <li>We prepare your project internally.</li>
                            <li>
                                We’ll contact you if anything else is needed.
                            </li>
                        </ol>

                        <p className="mt-4 text-sm leading-6">
                            You can close this page now. There is nothing else
                            you need to do at this stage.
                        </p>
                    </div>
                ) : (
                    <form
                        action={async () => {
                            "use server"
                            await completeStep(token, currentStep.key)
                        }}
                    >
                        <button className="mt-8 w-full rounded-xl bg-[#1E3A5F] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80">
                            Complete and continue
                        </button>
                    </form>
                )}
            </div>
        </OnboardingLayout>
    )
}
