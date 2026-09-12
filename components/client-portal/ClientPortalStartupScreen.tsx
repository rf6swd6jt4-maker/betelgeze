"use client"
/* eslint-disable @next/next/no-img-element -- token-scoped agency SVGs preserve their intrinsic proportions. */

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

const FALLBACK_PORTAL_BACKGROUND = "#F8F7F3"
const TOKEN_PATTERN = /(?:^|\/)([a-f0-9]{64})\/?$/i

type StartupAppearance = {
    backgroundColor: string
    logoSrc: string | null
}

export function ClientPortalStartupScreen() {
    const pathname = usePathname()
    const token = pathname.match(TOKEN_PATTERN)?.[1] ?? null
    const immediateLogoSrc = token
        ? `/api/client-branding/logo/client-portal/${encodeURIComponent(token)}`
        : null
    const [appearance, setAppearance] = useState<StartupAppearance>({
        backgroundColor: FALLBACK_PORTAL_BACKGROUND,
        logoSrc: null,
    })

    useEffect(() => {
        if (!token) return
        const controller = new AbortController()
        void fetch(`/api/client-portal/session/${encodeURIComponent(token)}/appearance`, {
            cache: "no-store",
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) return
            const result = await response.json() as Partial<StartupAppearance>
            if (controller.signal.aborted) return
            setAppearance({
                backgroundColor: /^#[0-9A-F]{6}$/i.test(result.backgroundColor ?? "") ? result.backgroundColor! : FALLBACK_PORTAL_BACKGROUND,
                logoSrc: typeof result.logoSrc === "string" ? result.logoSrc : null,
            })
        }).catch(() => undefined)
        return () => controller.abort()
    }, [token])

    return <div
        data-client-portal-startup-screen
        role="status"
        aria-label="Loading client portal"
        className="fixed inset-0 z-[2147483647] grid place-items-center overflow-hidden"
        style={{
            width: "100vw",
            height: "100dvh",
            minHeight: "100svh",
            backgroundColor: appearance.backgroundColor,
            padding: "max(1.5rem, env(safe-area-inset-top)) max(1.5rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1.5rem, env(safe-area-inset-left))",
        }}
    >
        {appearance.logoSrc || immediateLogoSrc ? <img
            src={appearance.logoSrc ?? immediateLogoSrc!}
            alt=""
            width={256}
            height={64}
            className="max-h-14 w-auto max-w-[min(72vw,16rem)] object-contain"
        /> : null}
    </div>
}
