import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES, StepKind } from "@/lib/onboarding/modules"
import { completeStep, skipTestStep } from "./actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import { ScrollToTopOnStepChange } from "@/components/onboarding/ScrollToTopOnStepChange"
import { OnboardingForm } from "@/components/onboarding/OnboardingForm"
import { TestClientMenu } from "@/components/onboarding/TestClientMenu"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"
import {
    FormResponse,
    getOnboardingForm,
} from "@/lib/onboarding/forms"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{
        token: string
    }>
    searchParams: Promise<{
        step?: string
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

export default async function SessionPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepKey } = await searchParams

    const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("id, name, email, phone, session_token, is_test")
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

    const linearCurrentStep =
        completableSteps.find((step) => !completedKeys.has(step.key)) ??
        FINAL_STEP
    const requestedStep = client.is_test
        ? steps.find((step) => step.key === requestedStepKey)
        : null
    const currentStep = requestedStep ?? linearCurrentStep

    const isFinalStep = currentStep.key === "final"
    const currentStepIndex = steps.findIndex(
        (step) => step.key === currentStep.key
    )
    const previousStep =
        currentStepIndex > 0 ? steps[currentStepIndex - 1] : null

    const roadmapSteps = steps.map((step) => ({
        key: step.key,
        title: step.title,
        complete:
            step.key === "final"
                ? linearCurrentStep.key === "final"
                : completedKeys.has(step.key),
        current: step.key === currentStep.key,
    }))

    const assignedModules =
        clientModules
            ?.map((row) => MODULES[row.module_key]?.title)
            .filter(Boolean) ?? []

    const currentForm =
        currentStep.kind === "form"
            ? getOnboardingForm(currentStep.formKey)
            : null

    const { data: currentFormResponse } =
        currentForm && currentStep.kind === "form"
            ? await supabaseAdmin
                  .from("client_form_responses")
                  .select("response")
                  .eq("client_id", client.id)
                  .eq("step_key", currentStep.key)
                  .maybeSingle()
            : { data: null }

    const initialResponse =
        currentFormResponse?.response &&
        typeof currentFormResponse.response === "object"
            ? (currentFormResponse.response as FormResponse)
            : undefined

    return (
        <OnboardingLayout
            roadmapSteps={roadmapSteps}
            client={{
                name: client.name,
                email: client.email,
                phone: client.phone,
                isTest: client.is_test,
            }}
            headerActions={
                client.is_test && !isFinalStep ? (
                    <TestClientMenu
                        currentStepTitle={currentStep.title}
                        previousStepHref={
                            previousStep
                                ? `/session/${token}?step=${previousStep.key}`
                                : null
                        }
                        skipAction={async () => {
                            "use server"
                            await skipTestStep(
                                token,
                                currentStep.key,
                                currentStep.formKey
                            )
                        }}
                    />
                ) : null
            }
        >
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
                            Your onboarding includes:
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
                                    No onboarding modules assigned yet.
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
                    currentForm ? (
                        <OnboardingForm
                            key={currentStep.key}
                            token={token}
                            stepKey={currentStep.key}
                            form={currentForm}
                            initialResponse={initialResponse}
                        />
                    ) : (
                        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
                            This form has not been configured yet.
                        </div>
                    )
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
                ) : currentStep.kind === "video" ? (
                    <form
                        action={async () => {
                            "use server"
                            await completeStep(token, currentStep.key)
                        }}
                    >
                        <FormPendingOverlay />

                        <button className="mt-8 w-full rounded-xl bg-[#1E3A5F] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80">
                            Complete and continue
                        </button>
                    </form>
                ) : null}
            </div>
        </OnboardingLayout>
    )
}
