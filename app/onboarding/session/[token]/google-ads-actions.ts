"use server"

import { loadGoogleAdsOnboarding, runGoogleAdsOnboarding } from "@/lib/onboarding/google-ads-server"

export async function getGoogleAdsOnboarding(token: string, blockId: string) {
    try { return { ok: true as const, ...await loadGoogleAdsOnboarding(token, blockId) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "The Google Ads connection could not be loaded." } }
}

export async function connectOnboardingGoogleAds(token: string, blockId: string, customerId: string, action: "request" | "verify") {
    if (action !== "request" && action !== "verify") return { ok: false as const, error: "Choose whether to request or verify access." }
    try { return { ok: true as const, connection: await runGoogleAdsOnboarding(token, blockId, customerId, action === "request") } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Google Ads could not be connected. Please try again." } }
}
