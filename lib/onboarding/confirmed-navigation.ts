import type { OnboardingSubmissionResult } from "./submission-client"

export function confirmedOnboardingNavigation(input: {
    result: Extract<OnboardingSubmissionResult, { ok: true }>
    compositionHash: string | null
    preparedAt: number
    stepKeys: string[]
    now: number
}) {
    const { result } = input
    if (result.clientPortalUrl || !result.nextStepKey || result.compositionHash !== input.compositionHash || input.now - input.preparedAt > 45 * 60 * 1000) return null
    const nextIndex = input.stepKeys.indexOf(result.nextStepKey)
    if (nextIndex < 0) return null
    return { key: result.nextStepKey, completed: input.stepKeys.slice(0, nextIndex) }
}
