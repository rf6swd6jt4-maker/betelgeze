"use server"

import { checkWindsorMetaAdsOnboarding, loadWindsorMetaAdsOnboarding } from "@/lib/onboarding/windsor-meta-ads-server"

export async function getWindsorMetaAdsOnboarding(token: string, blockId: string) {
    try { return { ok: true as const, ...await loadWindsorMetaAdsOnboarding(token, blockId) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "The Meta Ads reporting connection could not be loaded." } }
}

export async function verifyWindsorMetaAdsOnboarding(token: string, blockId: string, accountId?: string | null) {
    try { return { ok: true as const, ...await checkWindsorMetaAdsOnboarding(token, blockId, accountId) } }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "The Meta Ads reporting connection could not be checked." } }
}
