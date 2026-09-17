"use client"

import Link from "next/link"
import { useState } from "react"
import { Avatar } from "./Avatar"
import { AnchoredPopup } from "@/components/ui"

export function ProfileHeader({ username, displayName, avatarSrc }: { username: string; displayName: string; avatarSrc?: string | null }) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    return <header className="relative flex flex-col items-center px-12 pb-2 pt-10 text-center">
        <button data-icon-button type="button" aria-label="Profile options" aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)} className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-full p-0 text-neutral-400 hover:bg-neutral-900 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
        <Avatar src={avatarSrc} name={displayName} className="h-28 w-28 border border-neutral-700 sm:h-32 sm:w-32" />
        <h1 className="mt-5 max-w-full break-words text-3xl font-semibold tracking-tight">{displayName}</h1>
        <p className="mt-2 max-w-full break-all text-sm text-neutral-500">@{username}</p>
        {anchor ? <AnchoredPopup anchor={anchor} anchorPoint={{ x: anchor.offsetWidth, y: anchor.offsetHeight }} align="end" role="menu" onDismiss={() => setAnchor(null)} className="w-52 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 p-1.5 text-left shadow-2xl">
            <Link role="menuitem" href={`/users/${username}/edit`} onClick={() => setAnchor(null)} className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-neutral-800">Edit profile</Link>
            <Link role="menuitem" href={`/users/${username}/security`} onClick={() => setAnchor(null)} className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-neutral-800">Security</Link>
            <form action="/logout" method="post" className="mt-1 border-t border-neutral-800 pt-1"><button role="menuitem" className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm text-red-400 hover:bg-red-950/40">Log out</button></form>
        </AnchoredPopup> : null}
    </header>
}
