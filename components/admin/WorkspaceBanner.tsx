/* eslint-disable @next/next/no-img-element */

import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Props = {
    bannerPath: string | null
    logoPath: string | null
    name: string
    height: number
    position: number
}

export async function WorkspaceBanner({ bannerPath, logoPath, name, height, position }: Props) {
    if (!bannerPath && !logoPath) return null
    const [bannerSrc, logoSrc] = await Promise.all([
        bannerPath ? createUploadSignedUrl(bannerPath) : null,
        logoPath ? createUploadSignedUrl(logoPath) : null,
    ])

    if (!bannerSrc) return <div className="mb-5 flex h-20 items-end"><img src={logoSrc!} alt={`${name} logo`} className="h-20 w-20 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover" /></div>

    return <div className="relative mb-12 overflow-visible rounded-2xl border border-neutral-800 bg-neutral-900" style={{ height }}><img src={bannerSrc} alt={`${name} dashboard banner`} className="h-full w-full rounded-2xl object-cover" style={{ objectPosition: `50% ${position}%` }} />{logoSrc && <img src={logoSrc} alt={`${name} logo`} className="absolute bottom-0 left-5 h-20 w-20 translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover sm:left-7" />}</div>
}
