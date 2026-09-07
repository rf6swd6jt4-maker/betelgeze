"use client"

import { useState } from "react"
import type { SessionStep, OnboardingSessionNotice as SessionNotice } from "@/lib/onboarding/canonical"
import type { FormResponse } from "@/lib/onboarding/forms"
import type { OnboardingHelpSettings, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import type { OnboardingSubmissionResult } from "@/lib/onboarding/submission-client"
import { confirmedOnboardingNavigation } from "@/lib/onboarding/confirmed-navigation"
import { skipTestStep } from "@/app/onboarding/session/[token]/actions"
import { OnboardingAdvanceContext } from "./OnboardingAdvanceContext"
import { OnboardingLayout } from "./OnboardingLayout"
import { OnboardingSessionRenderer } from "./OnboardingSessionRenderer"
import { OnboardingStepSubmit } from "./OnboardingStepSubmit"
import { OnboardingSessionNotice } from "./OnboardingSessionNotice"
import { OnboardingThemeProvider } from "./OnboardingThemeProvider"
import { ScrollToTopOnStepChange } from "./ScrollToTopOnStepChange"
import { TestClientMenu } from "./TestClientMenu"

export type OnboardingSessionFlowProps = {
    token: string
    steps: SessionStep[]
    completableStepKeys: string[]
    initialStepKey: string
    initialCompletedKeys: string[]
    initialResponses: Record<string, FormResponse>
    compositionHash: string | null
    preparedAt: number
    sessionStatus: "active" | "completed" | "archived"
    isTest: boolean
    moduleTitles: string[]
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    notices: SessionNotice[]
    satisfiedBlockIds: string[]
    blockResponses: Record<string, unknown>
    client: { name: string | null; email: string | null; phone: string | null }
    workspaceName: string
    logoSrc: string | null
    privacyPolicyUrl: string | null
    termsOfServiceUrl: string | null
    basePath: string
    paymentComplete: boolean
    metaResult?: string
    connectionReason?: string
}

export function OnboardingSessionFlow({ token, steps, completableStepKeys, initialStepKey, initialCompletedKeys, initialResponses,
    compositionHash, preparedAt, sessionStatus, isTest, moduleTitles, theme, help, notices, satisfiedBlockIds, blockResponses,
    client, workspaceName, logoSrc, privacyPolicyUrl, termsOfServiceUrl, basePath, paymentComplete, metaResult, connectionReason,
}: OnboardingSessionFlowProps) {
    const [progress, setProgress] = useState({ key: initialStepKey, completed: initialCompletedKeys })
    const completedKeys = new Set(progress.completed)
    const completableSteps = steps.filter((step) => completableStepKeys.includes(step.key))
    const currentStep = steps.find((step) => step.key === progress.key) ?? steps[0]
    const linearCurrentStep = completableSteps.find((step) => !completedKeys.has(step.key)) ?? steps[steps.length - 1]
    const initialResponse = initialResponses[currentStep.key]
    const paymentContext = paymentComplete

    function advance(result: Extract<OnboardingSubmissionResult, { ok: true }>) {
        // Preloaded definitions are presentation only. The server decides what
        // is unlocked; refresh normally if it reports a changed composition.
        const confirmed = confirmedOnboardingNavigation({ result, compositionHash, preparedAt, stepKeys: completableStepKeys, now: Date.now() })
        if (!confirmed) return false
        setProgress(confirmed)
        window.history.replaceState(null, "", `${basePath}?step=${encodeURIComponent(confirmed.key)}`)
        return true
    }
    const isFinalStep = currentStep.kind === "final"
    const lastCompletableStep = completableSteps.at(-1) ?? null
    const everyCompletableStepIsDone = completableSteps.length > 0 && completableSteps.every((step) => completedKeys.has(step.key))
    const finalizationPending = sessionStatus === "active" && everyCompletableStepIsDone
    const canFinalizeHere = finalizationPending && (isFinalStep || currentStep.key === lastCompletableStep?.key)
    const stepIsLocked = sessionStatus === "completed" || completedKeys.has(currentStep.key)
    const currentStepIndex = steps.findIndex((step) => step.key === currentStep.key)
    const previousStep = currentStepIndex > 0 ? steps[currentStepIndex - 1] : null
    const roadmapSteps = [
        ...(paymentContext ? [{ key: "payment", title: "Payment", complete: true, current: false, href: null }] : []),
        ...steps.map((step) => ({
        key: step.key,
        title: step.title,
        complete: step.kind === "final" ? linearCurrentStep.kind === "final" : completedKeys.has(step.key),
        current: step.key === currentStep.key,
        href: sessionStatus === "completed" || completedKeys.has(step.key) || step.key === linearCurrentStep.key
            ? `${basePath}?step=${encodeURIComponent(step.key)}`
            : null,
        })),
    ]
    const visualFormBlock = currentStep.blocks?.find((block) => block.kind === "form")
    const usesDirectVisualCompletion = Boolean(currentStep.blocks?.length) && (!visualFormBlock || (visualFormBlock.kind === "form" && visualFormBlock.fields.length === 0))
    const migrationNotice = notices.find((notice) => (notice.sessionModuleId === currentStep.sessionModuleId || Boolean(currentStep.sessionStepId && notice.affectedStepIds.includes(currentStep.sessionStepId))) && (
            notice.requiresCompletion ? !notice.moduleCompletedAt : !notice.firstSeenAt
        )) ?? null

    return (
        <OnboardingAdvanceContext.Provider value={{ compositionHash, advance }}>
        <OnboardingThemeProvider theme={theme}>
        <OnboardingLayout
            clientSession
            roadmapSteps={roadmapSteps}
            onRoadmapSelect={(key) => {
                const href = roadmapSteps.find((step) => step.key === key)?.href
                if (href) window.location.assign(href)
            }}
            client={{
                name: client.name,
                email: client.email,
                phone: client.phone,
                isTest: isTest,
            }}
            workspaceName={workspaceName}
            logoSrc={logoSrc}
            help={help}
            privacyPolicyUrl={privacyPolicyUrl}
            termsOfServiceUrl={termsOfServiceUrl}
            headerActions={
                sessionStatus === "active" && isTest && !isFinalStep ? (
                    <TestClientMenu
                        currentStepTitle={currentStep.title}
                        previousStepHref={
                            previousStep
                                ? `${basePath}?step=${encodeURIComponent(previousStep.key)}`
                                : null
                        }
                        skipAction={async () => {
                            return skipTestStep(token, currentStep.key)
                        }}
                    />
                ) : null
            }
        >
            <ScrollToTopOnStepChange stepKey={currentStep.key} />

            <OnboardingSessionRenderer
                step={{ ...currentStep }}
                moduleTitles={moduleTitles}
                showModuleSummary={Boolean(currentStep.blocks?.length) || (currentStep.kind === "video" && (currentStep.moduleTitle === "General" || ["welcome", "welcome-video"].includes(currentStep.legacyStepKey ?? "")))}
                token={token}
                initialResponse={initialResponse}
                locked={stepIsLocked}
                allowEditRequest={sessionStatus === "active" && completedKeys.has(currentStep.key)}
                notice={currentStep.key === initialStepKey && metaResult === "connected" ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Facebook is connected. You can continue onboarding.</div> : currentStep.key === initialStepKey && metaResult === "error" ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{connectionReason || "Facebook could not be connected. Please try again."}</div> : migrationNotice ? (
                    <OnboardingSessionNotice
                        token={token}
                        noticeId={migrationNotice.id}
                        explanation={migrationNotice.explanation}
                        requiresCompletion={migrationNotice.requiresCompletion}
                        sections={migrationNotice.sections}
                    />
                ) : null}
                action={sessionStatus === "active" && (canFinalizeHere || (!isFinalStep && (currentStep.kind === "video" || usesDirectVisualCompletion) && !stepIsLocked)) ? (
                    <OnboardingStepSubmit
                        token={token}
                        stepKey={canFinalizeHere && lastCompletableStep ? lastCompletableStep.key : currentStep.key}
                        label={canFinalizeHere || currentStep.key === lastCompletableStep?.key
                            ? ["", "Continue", "Complete and continue"].includes(currentStep.navigation?.continueLabel ?? "")
                                ? "Finish onboarding"
                                : currentStep.navigation?.continueLabel ?? "Finish onboarding"
                            : currentStep.navigation?.continueLabel || "Complete and continue"}
                    />
                ) : null}
                satisfiedBlockIds={[...satisfiedBlockIds]}
                blockResponses={blockResponses}
                backHref={previousStep ? `${basePath}?step=${encodeURIComponent(previousStep.key)}` : null}
            />
        </OnboardingLayout>
        </OnboardingThemeProvider>
        </OnboardingAdvanceContext.Provider>
    )
}
