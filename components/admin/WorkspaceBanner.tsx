/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react"

import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Props = {
    bannerPath: string | null
    logoPath: string | null
    name: string
    height: number
    position: number
}

export function WorkspaceBannerFallback({ bannerPath, logoPath, height }: Pick<Props, "bannerPath" | "logoPath" | "height">) {
    if (!bannerPath && !logoPath) return null
    if (!bannerPath) {
        return <div aria-hidden="true" className="mb-5 flex h-[72px] items-end"><div className="h-[72px] w-[72px] animate-pulse rounded-full border-4 border-neutral-950 bg-neutral-900" /></div>
    }
    return <div aria-hidden="true" className="relative mb-12 h-[calc(var(--workspace-banner-height)*0.6)] animate-pulse rounded-xl border border-card-border sm:h-[var(--workspace-banner-height)] sm:rounded-2xl" style={{ "--workspace-banner-height": `${height}px` } as CSSProperties}>{logoPath ? <div className="absolute bottom-0 left-4 h-[72px] w-[72px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7" /> : null}</div>
}

export async function WorkspaceBanner({ bannerPath, logoPath, name, height, position }: Props) {
    if (!bannerPath && !logoPath) return null
    const [bannerSrc, logoSrc] = await Promise.all([
        bannerPath ? createUploadSignedUrl(bannerPath) : null,
        logoPath ? createUploadSignedUrl(logoPath) : null,
    ])

    if (!bannerSrc) return <div className="mb-5 flex h-[72px] items-end"><img src={logoSrc!} alt={`${name} logo`} className="h-[72px] w-[72px] rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover" /></div>

    return <div className="relative mb-12 h-[calc(var(--workspace-banner-height)*0.6)] overflow-visible rounded-xl border border-card-border sm:h-[var(--workspace-banner-height)] sm:rounded-2xl" style={{ "--workspace-banner-height": `${height}px` } as CSSProperties}><img src={bannerSrc} alt={`${name} dashboard banner`} className="h-full w-full rounded-xl object-cover sm:rounded-2xl" style={{ objectPosition: `50% ${position}%` }} />{logoSrc && <img src={logoSrc} alt={`${name} logo`} className="absolute bottom-0 left-4 h-[72px] w-[72px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover sm:left-7" />}</div>
}
