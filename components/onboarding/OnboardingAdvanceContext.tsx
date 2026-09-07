"use client"

import { createContext, useContext } from "react"
import type { OnboardingSubmissionResult } from "@/lib/onboarding/submission-client"

export const OnboardingAdvanceContext = createContext<{
    compositionHash: string | null
    advance: (result: Extract<OnboardingSubmissionResult, { ok: true }>) => boolean
} | null>(null)

export const useOnboardingAdvance = () => useContext(OnboardingAdvanceContext)
