import type { FormResponse } from "./forms"

export type OnboardingSubmissionResult = {
    ok: true
    nextStepKey: string | null
    nextPath: string
    clientPortalUrl: string | null
    compositionHash: string | null
} | { ok: false; error: string }

export async function postOnboardingSubmission(
    token: string,
    stepKey: string,
    response?: FormResponse,
    compositionHash?: string | null,
    fetcher: typeof fetch = fetch,
): Promise<OnboardingSubmissionResult> {
    // Reuse the exact payload if the server committed but its acknowledgement
    // was lost. The server checks it against the immutable saved response.
    const body = JSON.stringify({ stepKey, response, compositionHash })
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const result = await fetcher(`/api/onboarding/session/${encodeURIComponent(token)}/submit`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body,
                cache: "no-store", signal: AbortSignal.timeout(30_000),
            })
            if (result.status >= 500 && attempt === 0) continue
            const outcome: OnboardingSubmissionResult = await result.json()
            if (typeof outcome.ok !== "boolean") throw new Error("Invalid submission acknowledgement")
            if (outcome.ok && (!result.ok || typeof outcome.nextPath !== "string")) throw new Error("Invalid submission acknowledgement")
            return outcome
        } catch {
            if (attempt === 1) return { ok: false, error: "We could not confirm your save. Your answers are still here. Check your connection and try Continue again." }
        }
    }
    return { ok: false, error: "Could not confirm this submission. Please try again." }
}
