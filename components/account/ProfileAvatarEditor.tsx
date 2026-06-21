"use client"

import { ChangeEvent, useRef } from "react"
import { Avatar } from "@/components/account/Avatar"

function PencilIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m13.5 8.5 3 3" /></svg>
}

export function ProfileAvatarEditor({
    name,
    src,
    action,
}: {
    name: string
    src: string | null
    action: (formData: FormData) => Promise<void>
}) {
    const input = useRef<HTMLInputElement>(null)
    function upload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        if (!file) return
        event.currentTarget.form?.requestSubmit()
    }

    return <form action={action} className="flex flex-col items-start gap-3 sm:flex-row sm:items-center"><div className="relative"><Avatar src={src} name={name} className="h-24 w-24 border-2 border-neutral-700" /><button type="button" onClick={() => input.current?.click()} aria-label="Change profile picture" className="absolute bottom-0 right-0 inline-flex h-9 w-9 translate-x-1/4 translate-y-1/4 items-center justify-center rounded-full border border-white/20 bg-neutral-950 text-white shadow-lg transition hover:bg-neutral-800"><PencilIcon /></button><input ref={input} name="avatar" onChange={upload} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif" /></div><div><p className="text-sm font-medium text-neutral-200">Profile picture</p><p className="mt-1 text-sm text-neutral-400">Max resolution: 400×400px.</p></div></form>
}
