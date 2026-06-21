/* eslint-disable @next/next/no-img-element */

import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

export async function WorkspaceBanner({ path, name }: { path: string | null; name: string }) {
    if (!path) return null
    const src = await createUploadSignedUrl(path)
    return <div className="mt-5 h-36 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 sm:h-48"><img src={src} alt={`${name} dashboard banner`} className="h-full w-full object-cover" /></div>
}
