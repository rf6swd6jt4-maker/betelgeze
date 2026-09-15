"use client"
/* eslint-disable @next/next/no-img-element -- the token-scoped agency logo preserves its intrinsic proportions. */
import { usePathname } from "next/navigation"

/** The public form has its own agency brand, never the platform launch mark. */
export function OnboardingStartupScreen() {
    const token = usePathname().match(/(?:^|\/)([a-f0-9]{64})\/?$/i)?.[1]
    return <div role="status" aria-label="Loading onboarding" data-onboarding-startup-screen className="fixed inset-0 z-[100] grid place-items-center bg-[#F8F7F3] p-6">
        {token ? <img src={`/api/client-branding/logo/onboarding/${encodeURIComponent(token)}`} alt="" width={256} height={64} className="max-h-14 w-auto max-w-[min(72vw,16rem)] object-contain" /> : null}
    </div>
}
