// What the client page's Onboarding tab receives: the staff onboarding record reduced to what the tab shows. Built
// from the same access-scoped data as the record page (lib/onboarding/staff-detail.ts); nothing here widens it.

export type ClientOnboardingStep = {
    key: string; number: number; title: string; moduleTitle: string
    status: "not_submitted" | "submitted" | "reviewed" | "waiting" | "blocked" | "canceled"; statusLabel: string
    updatedAt: string | null; editRequested: boolean; instruction: boolean
    taskId: string | null
    answers: Array<{ key: string; label: string; value: string; uploads: ClientOnboardingUpload[] }>
    uploads: ClientOnboardingUpload[]
}
export type ClientOnboardingUpload = { id: string; title: string; kind: string; size: string }
export type ClientOnboardingSession = { id: string; status: string; isTest: boolean; createdAt: string; completedAt: string | null }
export type ClientOnboardingRecord = {
    sessionId: string; status: string; completed: boolean; isTest: boolean; stuck: boolean
    percentage: number; done: number; total: number; latestActivity: string | null
    services: string[]; modules: string[]
    link: { path: string | null; revoked: boolean; tokenVersion: number; canManage: boolean; canOpenComplete: boolean; archived: boolean }
    steps: ClientOnboardingStep[]
}
export type ClientOnboarding = {
    userId: string; relationshipId: string
    /** Every session of this client the person may open, newest first. More than one means the person chooses. */
    sessions: ClientOnboardingSession[]
    record: ClientOnboardingRecord | null
}

/** An answer as the record page words it: a count for uploaded files, otherwise the text or "No answer provided". */
export function onboardingAnswerText(value: unknown) {
    if (Array.isArray(value)) return `${value.length} uploaded file${value.length === 1 ? "" : "s"}`
    return String(value || "").trim() || "No answer provided"
}
