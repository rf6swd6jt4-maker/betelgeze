"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { AccountMenu } from "@/components/account/AccountMenu"

const historyKey = "betelgeze:workspace-history"

type WorkspaceHistoryState = {
    stack: string[]
    index: number
}

type Props = {
    workspace: { id: string; name: string }
    workspaceLogoSrc?: string | null
    username: string
    email: string
    avatarSrc?: string | null
    leaveAction: (formData: FormData) => void
}

function WorkspaceLogo({ src, name }: { src?: string | null; name: string }) {
    if (src) {
        return <img src={src} alt={`${name} logo`} className="h-9 w-9 shrink-0 rounded-full border border-neutral-700 bg-neutral-900 object-cover" />
    }

    return <div aria-label={`${name} logo`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-sm font-semibold text-neutral-200">{name.slice(0, 1).toUpperCase()}</div>
}

function ArrowLeftIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg>
}

function ArrowRightIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m9 6 6 6-6 6" /></svg>
}

function SidebarIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" /></svg>
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function parseStoredHistory(fallbackUrl: string): WorkspaceHistoryState {
    try {
        const stored = sessionStorage.getItem(historyKey)
        const parsed = stored ? JSON.parse(stored) as Partial<WorkspaceHistoryState> : {}
        const stack = Array.isArray(parsed.stack) && parsed.stack.every((entry) => typeof entry === "string") && parsed.stack.length ? parsed.stack : [fallbackUrl]
        const index = Number.isInteger(parsed.index) ? Math.min(Math.max(parsed.index!, 0), stack.length - 1) : stack.length - 1
        return { stack, index }
    } catch {
        return { stack: [fallbackUrl], index: 0 }
    }
}

function deferNavigationStateUpdate(update: () => void) {
    queueMicrotask(update)
}

export function WorkspaceTopBarClient({ workspace, workspaceLogoSrc, username, email, avatarSrc, leaveAction }: Props) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)

    useEffect(() => {
        const query = searchParams.toString()
        const current = `${pathname}${query ? `?${query}` : ""}`
        let { stack, index } = parseStoredHistory(current)

        if (stack[index] !== current) {
            const nextIndex = stack.indexOf(current)
            if (nextIndex >= 0) {
                index = nextIndex
            } else {
                stack = [...stack.slice(0, index + 1), current].slice(-50)
                index = stack.length - 1
            }
        }

        sessionStorage.setItem(historyKey, JSON.stringify({ stack, index }))
        deferNavigationStateUpdate(() => {
            setCanGoBack(index > 0 || window.history.length > 1)
            setCanGoForward(index < stack.length - 1)
        })
    }, [pathname, searchParams])

    useEffect(() => {
        function updateFromPopState() {
            const current = `${window.location.pathname}${window.location.search}`
            const parsedHistory = parseStoredHistory(current)
            let stack = parsedHistory.stack
            let index = stack.indexOf(current)
            if (index < 0) {
                stack = [...stack, current].slice(-50)
                index = stack.length - 1
            }
            sessionStorage.setItem(historyKey, JSON.stringify({ stack, index }))
            setCanGoBack(index > 0 || window.history.length > 1)
            setCanGoForward(index < stack.length - 1)
        }

        window.addEventListener("popstate", updateFromPopState)
        window.addEventListener("pageshow", updateFromPopState)

        return () => {
            window.removeEventListener("popstate", updateFromPopState)
            window.removeEventListener("pageshow", updateFromPopState)
        }
    }, [])

    function moveHistoryIndex(step: -1 | 1) {
        const current = `${window.location.pathname}${window.location.search}`
        const { stack, index } = parseStoredHistory(current)
        const nextIndex = index + step
        if (nextIndex < 0 || nextIndex >= stack.length) return
        sessionStorage.setItem(historyKey, JSON.stringify({ stack, index: nextIndex }))
        setCanGoBack(nextIndex > 0 || window.history.length > 1)
        setCanGoForward(nextIndex < stack.length - 1)
    }

    function goBack() {
        if (!canGoBack) return
        moveHistoryIndex(-1)
        window.history.back()
    }

    function goForward() {
        if (!canGoForward) return
        moveHistoryIndex(1)
        window.history.forward()
    }

    const navButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-400"

    return <>
        <header className="fixed left-0 top-0 z-50 h-14 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur">
            <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(20rem,40rem)_minmax(0,1fr)]">
                <div className="flex min-w-0 items-center gap-2.5">
                    <WorkspaceLogo src={workspaceLogoSrc} name={workspace.name} />
                    <p className="min-w-0 truncate text-sm font-semibold text-neutral-100">{workspace.name}</p>
                    <button type="button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle sidebar" aria-expanded={sidebarOpen} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white">
                        <SidebarIcon />
                    </button>
                </div>

                <div className="hidden min-w-0 items-center gap-1 md:flex">
                    <button type="button" onClick={goBack} disabled={!canGoBack} aria-label="Go back" className={navButtonClass}>
                        <ArrowLeftIcon />
                    </button>
                    <button type="button" onClick={goForward} disabled={!canGoForward} aria-label="Go forward" className={navButtonClass}>
                        <ArrowRightIcon />
                    </button>
                    <label className="relative min-w-0 flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                        <input readOnly aria-label="Search Betelgeze" placeholder="Search Betelgeze..." className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-9 text-sm text-neutral-300 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10" />
                    </label>
                </div>

                <div className="flex justify-end">
                    <AccountMenu username={username} email={email} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveAction} buttonClassName="h-9 w-9" />
                </div>
            </div>
        </header>

        <aside aria-hidden={!sidebarOpen} className={`fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-72 border-r border-neutral-800 bg-neutral-950/95 shadow-2xl shadow-black/30 transition-transform duration-200 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`} />
        <div className="h-14" />
    </>
}
