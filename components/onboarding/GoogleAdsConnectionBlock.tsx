"use client"
import { GoogleAdsConnection } from "@/components/google-ads/GoogleAdsConnection"
import type { ConnectionBlock } from "@/lib/onboarding/block-definition"
type Props = { block: ConnectionBlock; token: string; sessionBlockId?: string; initialResponse?: unknown; locked: boolean; preview: boolean; satisfied: boolean; onSatisfied: () => void; onUnsatisfied: () => void }
export function GoogleAdsConnectionBlock({ token, sessionBlockId, initialResponse, locked, preview, satisfied, onSatisfied, onUnsatisfied }: Props) {
    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-4 text-left sm:p-5">
        <GoogleAdsConnection api={sessionBlockId ? `/api/onboarding/session/${token}/connections/google-ads/${sessionBlockId}` : null} preview={preview} locked={locked} initialResponse={initialResponse} satisfied={satisfied} onState={(_connection, ok) => { if (ok) onSatisfied(); else onUnsatisfied() }} />
    </div>
}
