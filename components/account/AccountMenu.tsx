"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LeaveWorkspaceForm } from "@/components/account/LeaveWorkspaceForm"
import { Avatar } from "@/components/account/Avatar"

type Props = { username: string; email: string; avatarSrc?: string | null; workspaceId: string; workspaceName: string; leaveAction: (formData: FormData) => void; buttonClassName?: string }

export function AccountMenu({ username, email, avatarSrc, workspaceId, workspaceName, leaveAction, buttonClassName }: Props) {
    const [open, setOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false) }
        const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
        document.addEventListener("mousedown", close); document.addEventListener("keydown", escape)
        return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape) }
    }, [])
    return <div ref={menuRef} className="relative">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Open account menu" aria-expanded={open} aria-haspopup="menu" className={`inline-flex items-center justify-center rounded-full border border-neutral-600 bg-neutral-900 hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-white/30 ${buttonClassName ?? "h-11 w-11 sm:h-10 sm:w-10"}`}><Avatar src={avatarSrc} name={username} className="h-full w-full" /></button>
        {open && <div role="menu" className="absolute right-0 z-30 mt-2 w-[calc(100vw-2rem)] max-w-72 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"><div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3"><Avatar src={avatarSrc} name={username} className="h-10 w-10 shrink-0" /><div className="min-w-0"><p className="truncate text-sm font-medium text-white">@{username}</p><p className="mt-0.5 truncate text-xs text-neutral-400">{email}</p></div></div><div className="border-b border-neutral-800 px-4 py-3"><p className="text-xs text-neutral-500">Current workspace</p><p className="mt-1 truncate text-sm font-medium text-white">{workspaceName}</p></div><Link href={`/users/${username}`} role="menuitem" className="block min-h-11 px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-800">View profile</Link><Link href="/logout" role="menuitem" className="block min-h-11 px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-800">Log out</Link><div className="border-t border-neutral-800 p-2"><LeaveWorkspaceForm action={leaveAction} workspaceId={workspaceId} className="min-h-11 w-full border-0 px-2 py-2 text-left hover:bg-red-500/10" /></div></div>}
    </div>
}
