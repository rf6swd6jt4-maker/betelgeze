"use client"

/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { AccountMenu } from "@/components/account/AccountMenu"

const historyKey = "betelgeze:workspace-history"

type WorkspaceHistoryState = {
    stack: string[]
    index: number
}

type Props = {
    workspace: { id: string; name: string; slug: string }
    workspaceLogoSrc?: string | null
    username: string
    email: string
    avatarSrc?: string | null
    leaveAction: (formData: FormData) => void
}

type SearchResult = {
    id: string
    type: string
    label: string
    description: string
    href: string
    hubHref?: string
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

function HomeIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m4 11 8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>
}

function RelationshipsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M16 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M3 21a5 5 0 0 1 10 0" /><path d="M12 21a5 5 0 0 1 9 0" /></svg>
}

function WorkIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="m3 6 .8.8L5.5 5" /><path d="m3 12 .8.8 1.7-1.8" /><path d="m3 18 .8.8 1.7-1.8" /></svg>
}

function LeadIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 3 5-7" /></svg>
}

function SettingsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="12" cy="12" r="3" /><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="m5.6 5.6 2.1 2.1" /><path d="m16.3 16.3 2.1 2.1" /><path d="m18.4 5.6-2.1 2.1" /><path d="m7.7 16.3-2.1 2.1" /></svg>
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
    const searchRef = useRef<HTMLDivElement>(null)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)
    const [query, setQuery] = useState("")
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])

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

    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSearchOpen(false)
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
        }
    }, [])

    useEffect(() => {
        document.body.dataset.workspaceSidebarOpen = sidebarOpen ? "true" : "false"
        document.documentElement.style.setProperty("--workspace-sidebar-width", sidebarOpen ? "18rem" : "0px")

        return () => {
            document.body.dataset.workspaceSidebarOpen = "false"
            document.documentElement.style.setProperty("--workspace-sidebar-width", "0px")
        }
    }, [sidebarOpen])

    useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length < 2) {
            deferNavigationStateUpdate(() => {
                setSearchResults([])
                setSearchLoading(false)
            })
            return
        }

        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            setSearchLoading(true)
            try {
                const response = await fetch(`/api/workspaces/${workspace.slug}/search?q=${encodeURIComponent(trimmed)}`, {
                    signal: controller.signal,
                })
                if (!response.ok) throw new Error("Search failed")
                const payload = await response.json() as { results?: SearchResult[] }
                setSearchResults(payload.results ?? [])
            } catch (error) {
                if ((error as Error).name !== "AbortError") setSearchResults([])
            } finally {
                setSearchLoading(false)
            }
        }, 180)

        return () => {
            controller.abort()
            window.clearTimeout(timeout)
        }
    }, [query, workspace.slug])

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
    const sidebarItems = [
        { label: "Home", href: `/${workspace.slug}`, icon: <HomeIcon /> },
        { label: "Relationships", href: `/${workspace.slug}/relationships`, icon: <RelationshipsIcon /> },
        { label: "Work Queue", href: `/${workspace.slug}/work`, icon: <WorkIcon /> },
        { label: "Lead Gen", href: `/${workspace.slug}/leadgen`, icon: <LeadIcon /> },
        { label: "Onboarding", href: `/${workspace.slug}?filter=active`, icon: <WorkIcon /> },
        { label: "Settings", href: `/${workspace.slug}/settings`, icon: <SettingsIcon /> },
    ]

    return <>
        <header data-workspace-topbar className="fixed left-0 top-0 z-50 h-14 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur">
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
                    <div ref={searchRef} className="relative min-w-0 flex-1">
                        <label className="relative block">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                            <input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true) }} onFocus={() => setSearchOpen(true)} aria-label="Search Betelgeze" placeholder="Search relationships, work, leads..." className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-9 text-sm text-neutral-300 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10" />
                        </label>
                        {searchOpen && query.trim().length >= 2 && (
                            <div className="absolute left-0 right-0 top-11 z-[70] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40">
                                {searchLoading && <p className="px-3 py-2 text-sm text-neutral-500">Searching...</p>}
                                {!searchLoading && searchResults.length === 0 && <p className="px-3 py-2 text-sm text-neutral-500">No core results found.</p>}
                                {!searchLoading && searchResults.map((item) => (
                                    <div key={item.id} className="border-b border-neutral-900 last:border-0">
                                        <Link href={item.href} className="block px-3 py-2 hover:bg-neutral-900" onClick={() => setSearchOpen(false)}>
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-neutral-100">{item.label}</p>
                                                    <p className="mt-0.5 truncate text-xs text-neutral-500">{item.description}</p>
                                                </div>
                                                <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{item.type}</span>
                                            </div>
                                        </Link>
                                        {item.hubHref && item.hubHref !== item.href && (
                                            <Link href={item.hubHref} className="block px-3 pb-2 text-xs text-neutral-500 hover:text-neutral-200" onClick={() => setSearchOpen(false)}>
                                                View in Relationship Hub
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end">
                    <AccountMenu username={username} email={email} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveAction} buttonClassName="h-9 w-9" />
                </div>
            </div>
        </header>

        <aside data-workspace-sidebar aria-hidden={!sidebarOpen} className={`fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-72 border-r border-neutral-800 bg-neutral-950 transition-transform duration-200 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <nav className="flex h-full flex-col gap-1 px-3 py-4">
                {sidebarItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href === `/${workspace.slug}` && pathname === "/admin")
                    return (
                        <Link key={item.label} href={item.href} onClick={() => setSidebarOpen(false)} className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition ${active ? "bg-neutral-900 text-white" : "text-neutral-400 hover:bg-neutral-900/70 hover:text-white"}`}>
                            <span className="shrink-0">{item.icon}</span>
                            <span>{item.label}</span>
                        </Link>
                    )
                })}
            </nav>
        </aside>
        <div className="h-14" />
    </>
}
