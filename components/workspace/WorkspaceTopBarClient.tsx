"use client"

/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AccountMenu } from "@/components/account/AccountMenu"
import { LEADGEN_POLLING_SYSTEM_VERSION_LABEL } from "@/lib/leadgen/version"

const historyKey = "betelgeze:workspace-history"
const sidebarStorageKey = "betelgeze:workspace-sidebar-open"

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
    path?: string
    recordId?: string
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
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" /></svg>
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function SearchResultContent({ item, mobile = false }: { item: SearchResult; mobile?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-100">{item.label}</p>
                {item.path && <p className="mt-0.5 truncate text-[11px] text-neutral-400">{item.path}</p>}
                <p className={`mt-0.5 text-xs text-neutral-500 ${mobile ? "line-clamp-2" : "truncate"}`}>{item.description}</p>
                {item.recordId && <p className="mt-1 truncate font-mono text-[10px] text-neutral-600">ID {item.recordId}</p>}
            </div>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{item.type}</span>
        </div>
    )
}

function HomeIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="m4 11 8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>
}

function RelationshipsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M16 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M3 21a5 5 0 0 1 10 0" /><path d="M12 21a5 5 0 0 1 9 0" /></svg>
}

function WorkIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="m3 6 .8.8L5.5 5" /><path d="m3 12 .8.8 1.7-1.8" /><path d="m3 18 .8.8 1.7-1.8" /></svg>
}

function LeadIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 3 5-7" /></svg>
}

function HealthIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M4 13h4l2-7 4 12 2-5h4" /><path d="M4 19h16" /></svg>
}

function SettingsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><circle cx="12" cy="12" r="3" /><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="m5.6 5.6 2.1 2.1" /><path d="m16.3 16.3 2.1 2.1" /><path d="m18.4 5.6-2.1 2.1" /><path d="m7.7 16.3-2.1 2.1" /></svg>
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

function writeStoredHistory(state: WorkspaceHistoryState) {
    sessionStorage.setItem(historyKey, JSON.stringify(state))
}

function deferNavigationStateUpdate(update: () => void) {
    queueMicrotask(update)
}

function workspaceHref(workspaceSlug: string, suffix = "") {
    const cleanSuffix = suffix.replace(/^\/+/, "")
    return `/${workspaceSlug}${cleanSuffix ? `/${cleanSuffix}` : ""}`
}

function normalizeSearch(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")
}

type LocalSearchResult = SearchResult & { path: string; keywords: string[] }

function localResult(id: string, type: string, label: string, description: string, href: string, path: string, keywords: string[] = []): LocalSearchResult {
    return { id, type, label, description, href, path, keywords }
}

function localSearchResults(workspace: { name: string; slug: string }, value: string): SearchResult[] {
    const query = normalizeSearch(value)
    if (query.length < 2) return []
    const settingsPath = `${workspace.name} > Settings`
    const entries = [
        localResult("page-home", "Page", "Home", "Workspace home and onboarding overview", workspaceHref(workspace.slug), workspace.name, ["dashboard", "clients", "onboarding"]),
        localResult("page-relationships", "Page", "Relationships", "Relationship Hub list", workspaceHref(workspace.slug, "relationships"), `${workspace.name} > Relationships`, ["crm", "clients", "people"]),
        localResult("page-work", "Page", "Work Queue", "Shared relationship work items", workspaceHref(workspace.slug, "work"), `${workspace.name} > Work Queue`, ["tasks", "project management", "queue"]),
        localResult("page-leadgen", "Page", "Lead Gen", "Lead generation dashboard", workspaceHref(workspace.slug, "leadgen"), `${workspace.name} > Lead Gen`, ["leads", "lead generation"]),
        localResult("action-new-poll", "Action", "New Poll", "Create and preflight a new lead-generation poll", workspaceHref(workspace.slug, "leadgen/new"), `${workspace.name} > Lead Gen > New Poll`, ["create poll", "start poll", "run poll", "poll preflight", "leadgen new"]),
        localResult("page-polls", "Tab", "Polls", "Lead generation poll history", workspaceHref(workspace.slug, "leadgen/polls"), `${workspace.name} > Lead Gen > Polls`, ["runs", "automation history"]),
        localResult("page-invoices", "Page", "Invoices", "Client invoices and sales", workspaceHref(workspace.slug, "invoices"), `${workspace.name} > Invoices`, ["sales", "stripe"]),
        localResult("action-create-invoice", "Action", "Create Invoice", "Create and send a Stripe invoice", workspaceHref(workspace.slug, "sales/new"), `${workspace.name} > Invoices > Create Invoice`, ["new invoice", "invoice", "stripe invoice", "send invoice", "sales invoice"]),
        localResult("action-manual-client", "Action", "Add Manual Client", "Add a client manually without invoice automation", workspaceHref(workspace.slug, "clients/new"), `${workspace.name} > Relationships > Manual Client`, ["manual client", "new client", "add client", "create client", "client manually"]),
        localResult("page-settings", "Page", "Settings", "Unified workspace settings", workspaceHref(workspace.slug, "settings"), settingsPath, ["workspace settings"]),
        localResult("settings-leadgen-sources-seed", "Settings", "Seed Sources", "Candidate creation sources required before staged validation and owner discovery can run", workspaceHref(workspace.slug, "settings#leadgen-sources-seed"), `${settingsPath} > Lead Gen Sources > Seed Sources`, ["lead gen source category", "source categories", "seed sources", "candidate sources"]),
        localResult("settings-leadgen-sources-business-validation", "Settings", "Business Validation Sources", "Sources that confirm a seeded business is real enough to enter the owner pipeline", workspaceHref(workspace.slug, "settings#leadgen-sources-business-validation"), `${settingsPath} > Lead Gen Sources > Business Validation Sources`, ["lead gen source category", "source categories", "business validation", "validation sources"]),
        localResult("settings-leadgen-sources-owner-identity", "Settings", "Owner Identity Discovery", "Sources that can find credible owner, principal, license holder, or authorised official names", workspaceHref(workspace.slug, "settings#leadgen-sources-owner-identity"), `${settingsPath} > Lead Gen Sources > Owner Identity Discovery`, ["lead gen source category", "source categories", "owner identity", "owner discovery", "owner name sources"]),
        localResult("settings-leadgen-sources-owner-phone", "Settings", "Owner Phone Sources", "Sources that can attach phone numbers to discovered owners or principals", workspaceHref(workspace.slug, "settings#leadgen-sources-owner-phone"), `${settingsPath} > Lead Gen Sources > Owner Phone Sources`, ["lead gen source category", "source categories", "owner phone", "phone discovery"]),
        localResult("settings-leadgen-sources-phone-validation", "Settings", "Phone Validation Sources", "Sources that check owner-phone format and future reachability signals", workspaceHref(workspace.slug, "settings#leadgen-sources-phone-validation"), `${settingsPath} > Lead Gen Sources > Phone Validation Sources`, ["lead gen source category", "source categories", "phone validation", "validate phones"]),
    ]

    return entries
        .filter((entry) => [entry.label, entry.description, entry.path, ...entry.keywords].some((item) => normalizeSearch(item).includes(query)))
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            label: entry.label,
            description: entry.description,
            href: entry.href,
            path: entry.path,
        }))
        .slice(0, 8)
}

function directSearchHref(workspaceSlug: string, value: string) {
    const normalized = normalizeSearch(value)
    if (normalized === "new poll" || normalized === "create poll" || normalized === "start poll" || normalized === "run poll") return workspaceHref(workspaceSlug, "leadgen/new")
    if (normalized === "invoices" || normalized === "invoice") return workspaceHref(workspaceSlug, "invoices")
    if (normalized === "new invoice" || normalized === "create invoice" || normalized === "send invoice") return workspaceHref(workspaceSlug, "sales/new")
    if (normalized === "manual client" || normalized === "add manual client" || normalized === "new client" || normalized === "add client") return workspaceHref(workspaceSlug, "clients/new")
    if (normalized === "seed sources" || normalized === "seed source category") return workspaceHref(workspaceSlug, "settings#leadgen-sources-seed")
    if (normalized === "business validation" || normalized === "business validation sources") return workspaceHref(workspaceSlug, "settings#leadgen-sources-business-validation")
    if (normalized === "owner identity" || normalized === "owner identity discovery" || normalized === "owner discovery") return workspaceHref(workspaceSlug, "settings#leadgen-sources-owner-identity")
    if (normalized === "owner phone" || normalized === "owner phone sources" || normalized === "phone discovery") return workspaceHref(workspaceSlug, "settings#leadgen-sources-owner-phone")
    if (normalized === "phone validation" || normalized === "phone validation sources") return workspaceHref(workspaceSlug, "settings#leadgen-sources-phone-validation")
    return null
}

function mergeSearchResults(primary: SearchResult[], secondary: SearchResult[]) {
    const seen = new Set<string>()
    return [...primary, ...secondary].filter((item) => {
        const key = `${item.id}:${item.href}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    }).slice(0, 20)
}

export function WorkspaceTopBarClient({ workspace, workspaceLogoSrc, username, email, avatarSrc, leaveAction }: Props) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const searchMenuId = useId()
    const desktopSearchRef = useRef<HTMLDivElement>(null)
    const desktopSearchInputRef = useRef<HTMLInputElement>(null)
    const mobileSearchRef = useRef<HTMLDivElement>(null)
    const mobileSearchInputRef = useRef<HTMLInputElement>(null)
    const sidebarTransitionTimeout = useRef<number | null>(null)
    const searchCache = useRef<Map<string, SearchResult[]>>(new Map())
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [sidebarHydrated, setSidebarHydrated] = useState(false)
    const [sidebarTransitionEnabled, setSidebarTransitionEnabled] = useState(false)
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)
    const [query, setQuery] = useState("")
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])
    const [searchShortcutLabel, setSearchShortcutLabel] = useState("Ctrl+J")
    const workspaceName = workspace.name
    const workspaceSlug = workspace.slug
    const searchParamString = searchParams.toString()

    useEffect(() => {
        const current = `${pathname}${searchParamString ? `?${searchParamString}` : ""}`
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

        writeStoredHistory({ stack, index })
        const previousUrl = index > 0 ? stack[index - 1] : null
        const nextUrl = index < stack.length - 1 ? stack[index + 1] : null
        if (previousUrl?.startsWith("/")) router.prefetch(previousUrl)
        if (nextUrl?.startsWith("/")) router.prefetch(nextUrl)
        deferNavigationStateUpdate(() => {
            setCanGoBack(index > 0)
            setCanGoForward(index < stack.length - 1)
        })
    }, [pathname, router, searchParamString])

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
            writeStoredHistory({ stack, index })
            setCanGoBack(index > 0)
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
            const target = event.target as Node
            const inDesktopSearch = desktopSearchRef.current?.contains(target)
            const inMobileSearch = mobileSearchRef.current?.contains(target)
            if (!inDesktopSearch && !inMobileSearch) setSearchOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSearchOpen(false)
        }
        const closeForOtherDropdown = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== searchMenuId) setSearchOpen(false)
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [searchMenuId])

    useEffect(() => {
        const isMac = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform) || /Mac OS|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
        deferNavigationStateUpdate(() => setSearchShortcutLabel(isMac ? "⌘J" : "Ctrl+J"))
        const openFromShortcut = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "j") return
            if (isMac ? !event.metaKey : !event.ctrlKey) return
            event.preventDefault()
            window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
            setSearchOpen(true)
            window.requestAnimationFrame(() => {
                if (window.matchMedia("(min-width: 768px)").matches) desktopSearchInputRef.current?.focus()
                else mobileSearchInputRef.current?.focus()
            })
        }
        document.addEventListener("keydown", openFromShortcut)
        return () => document.removeEventListener("keydown", openFromShortcut)
    }, [searchMenuId])

    useEffect(() => {
        deferNavigationStateUpdate(() => {
            setSidebarOpen(sessionStorage.getItem(sidebarStorageKey) === "true")
            setSidebarHydrated(true)
        })
    }, [])

    useEffect(() => {
        return () => {
            if (sidebarTransitionTimeout.current) window.clearTimeout(sidebarTransitionTimeout.current)
        }
    }, [])

    useEffect(() => {
        document.body.dataset.workspaceSidebarOpen = sidebarOpen ? "true" : "false"
        document.body.dataset.workspaceSidebarTransition = sidebarTransitionEnabled ? "true" : "false"
        document.documentElement.style.setProperty("--workspace-sidebar-width", sidebarOpen ? "18rem" : "0px")
        if (sidebarHydrated) sessionStorage.setItem(sidebarStorageKey, sidebarOpen ? "true" : "false")

        return () => {
            document.body.dataset.workspaceSidebarOpen = "false"
            document.body.dataset.workspaceSidebarTransition = "false"
            document.documentElement.style.setProperty("--workspace-sidebar-width", "0px")
        }
    }, [sidebarOpen, sidebarHydrated, sidebarTransitionEnabled])

    useEffect(() => {
        if (searchOpen) mobileSearchInputRef.current?.focus()
    }, [searchOpen])

    useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length < 2) {
            deferNavigationStateUpdate(() => {
                setSearchResults([])
                setSearchLoading(false)
            })
            return
        }

        const normalized = normalizeSearch(trimmed)
        const localResults = localSearchResults({ name: workspaceName, slug: workspaceSlug }, trimmed)
        const directHref = directSearchHref(workspaceSlug, trimmed)
        deferNavigationStateUpdate(() => {
            setSearchResults(localResults)
            setSearchLoading(localResults.length === 0)
        })

        if (directHref && localResults[0]?.href === directHref) {
            deferNavigationStateUpdate(() => setSearchLoading(false))
            return
        }

        const cached = searchCache.current.get(normalized)
        if (cached) {
            deferNavigationStateUpdate(() => {
                setSearchResults(mergeSearchResults(localResults, cached))
                setSearchLoading(false)
            })
            return
        }

        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            if (localResults.length === 0) setSearchLoading(true)
            try {
                const response = await fetch(`/api/workspaces/${workspaceSlug}/search?q=${encodeURIComponent(trimmed)}`, {
                    signal: controller.signal,
                })
                if (!response.ok) throw new Error("Search failed")
                const payload = await response.json() as { results?: SearchResult[] }
                const remoteResults = payload.results ?? []
                searchCache.current.set(normalized, remoteResults)
                setSearchResults(mergeSearchResults(localResults, remoteResults))
            } catch (error) {
                if ((error as Error).name !== "AbortError") setSearchResults(localResults)
            } finally {
                setSearchLoading(false)
            }
        }, localResults.length ? 90 : 120)

        return () => {
            controller.abort()
            window.clearTimeout(timeout)
        }
    }, [query, workspaceName, workspaceSlug])

    function moveHistoryIndex(step: -1 | 1) {
        const current = `${window.location.pathname}${window.location.search}`
        const { stack, index } = parseStoredHistory(current)
        const nextIndex = index + step
        if (nextIndex < 0 || nextIndex >= stack.length) return null
        writeStoredHistory({ stack, index: nextIndex })
        setCanGoBack(nextIndex > 0)
        setCanGoForward(nextIndex < stack.length - 1)
        return stack[nextIndex]
    }

    function goBack() {
        if (!canGoBack) return
        const href = moveHistoryIndex(-1)
        if (href) router.replace(href)
    }

    function goForward() {
        if (!canGoForward) return
        const href = moveHistoryIndex(1)
        if (href) router.replace(href)
    }

    function openSearch() {
        setSearchOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
            return next
        })
    }

    function openDesktopSearch() {
        if (!searchOpen) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
        setSearchOpen(true)
    }

    function submitSearch(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Enter") return
        const href = directSearchHref(workspaceSlug, query) ?? searchResults[0]?.href
        if (!href) return
        event.preventDefault()
        setSearchOpen(false)
        router.push(href)
    }

    function toggleSidebar() {
        if (sidebarTransitionTimeout.current) window.clearTimeout(sidebarTransitionTimeout.current)
        setSidebarTransitionEnabled(true)
        sidebarTransitionTimeout.current = window.setTimeout(() => {
            setSidebarTransitionEnabled(false)
            sidebarTransitionTimeout.current = null
        }, 240)
        setSidebarOpen((value) => !value)
    }

    function closeSidebarAfterNavigation() {
        if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false)
    }

    const navButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-400"
    const sidebarItems = [
        { label: "Home", href: `/${workspace.slug}`, icon: <HomeIcon /> },
        { label: "Relationships", href: `/${workspace.slug}/relationships`, icon: <RelationshipsIcon /> },
        { label: "Work Queue", href: `/${workspace.slug}/work`, icon: <WorkIcon /> },
        { label: "Lead Gen", meta: LEADGEN_POLLING_SYSTEM_VERSION_LABEL, href: `/${workspace.slug}/leadgen`, icon: <LeadIcon /> },
        { label: "Onboarding", href: `/${workspace.slug}?filter=active`, icon: <WorkIcon /> },
        { label: "System Health", href: `/${workspace.slug}/health`, icon: <HealthIcon /> },
        { label: "Settings", href: `/${workspace.slug}/settings`, icon: <SettingsIcon /> },
    ]

    return <>
        <header data-workspace-topbar className="fixed left-0 top-0 z-50 h-14 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur">
            <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(20rem,40rem)_minmax(0,1fr)] md:gap-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <WorkspaceLogo src={workspaceLogoSrc} name={workspace.name} />
                    <p className="min-w-0 truncate text-sm font-semibold text-neutral-100">{workspace.name}</p>
                    <button data-icon-button type="button" onClick={toggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-8 md:w-8">
                        <SidebarIcon />
                    </button>
                </div>

                <div ref={desktopSearchRef} className="relative hidden min-w-0 items-center gap-1 md:flex">
                    <button data-icon-button type="button" onClick={goBack} disabled={!canGoBack} aria-label="Go back" className={navButtonClass}>
                        <ArrowLeftIcon />
                    </button>
                    <button data-icon-button type="button" onClick={goForward} disabled={!canGoForward} aria-label="Go forward" className={navButtonClass}>
                        <ArrowRightIcon />
                    </button>
                    <label className="relative block min-w-0 flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                        <input ref={desktopSearchInputRef} value={query} onKeyDown={submitSearch} onChange={(event) => { setQuery(event.target.value); openDesktopSearch() }} onFocus={openDesktopSearch} aria-label="Search Betelgeze" placeholder="Search relationships, work, leads..." className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-9 pr-16 text-sm text-neutral-300 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10" />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] leading-none text-neutral-500">{searchShortcutLabel}</span>
                    </label>
                    {searchOpen && (
                        <div className="absolute left-16 right-0 top-11 z-[70] max-h-[32rem] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40">
                            <div className="max-h-[32rem] overflow-y-auto">
                                {query.trim().length < 2 && <p className="px-3 py-3 text-sm text-neutral-500">Type at least two characters.</p>}
                                {query.trim().length >= 2 && searchLoading && <p className="px-3 py-3 text-sm text-neutral-500">Searching...</p>}
                                {query.trim().length >= 2 && !searchLoading && searchResults.length === 0 && <p className="px-3 py-3 text-sm text-neutral-500">No core results found.</p>}
                                {query.trim().length >= 2 && !searchLoading && searchResults.map((item) => (
                                    <div key={item.id} className="border-b border-neutral-900 last:border-0">
                                        <Link href={item.href} className="block px-3 py-2 hover:bg-neutral-900" onClick={() => setSearchOpen(false)}>
                                            <SearchResultContent item={item} />
                                        </Link>
                                        {item.hubHref && item.hubHref !== item.href && (
                                            <Link href={item.hubHref} className="block px-3 pb-2 text-xs text-neutral-500 hover:text-neutral-200" onClick={() => setSearchOpen(false)}>
                                                View in Relationship Hub
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2.5">
                    <div ref={mobileSearchRef} className="relative md:hidden">
                        <button data-icon-button type="button" onClick={openSearch} aria-label="Search Betelgeze" aria-expanded={searchOpen} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-9 md:w-9">
                            <SearchIcon />
                        </button>
                        {searchOpen && (
                            <div className="fixed left-3 right-3 top-16 z-[70] max-h-[72vh] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40 sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:max-h-[32rem] sm:w-[26rem] sm:max-w-[calc(100vw-2rem)]">
                                <div className="border-b border-neutral-800 p-3">
                                    <label className="relative block">
                                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                                        <input ref={mobileSearchInputRef} value={query} onKeyDown={submitSearch} onChange={(event) => setQuery(event.target.value)} aria-label="Search Betelgeze" placeholder="Search relationships, work, leads..." className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-10 text-base text-neutral-200 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10 md:h-9 md:text-sm" />
                                    </label>
                                </div>
                                <div className="max-h-[calc(72vh-4.25rem)] overflow-y-auto sm:max-h-[27.75rem]">
                                    {query.trim().length < 2 && <p className="px-3 py-3 text-sm text-neutral-500">Type at least two characters.</p>}
                                    {query.trim().length >= 2 && searchLoading && <p className="px-3 py-3 text-sm text-neutral-500">Searching...</p>}
                                    {query.trim().length >= 2 && !searchLoading && searchResults.length === 0 && <p className="px-3 py-3 text-sm text-neutral-500">No core results found.</p>}
                                    {query.trim().length >= 2 && !searchLoading && searchResults.map((item) => (
                                        <div key={item.id} className="border-b border-neutral-900 last:border-0">
                                            <Link href={item.href} className="block px-3 py-3 hover:bg-neutral-900 md:py-2" onClick={() => setSearchOpen(false)}>
                                                <SearchResultContent item={item} mobile />
                                            </Link>
                                            {item.hubHref && item.hubHref !== item.href && (
                                                <Link href={item.hubHref} className="block px-3 pb-3 text-xs text-neutral-500 hover:text-neutral-200 md:pb-2" onClick={() => setSearchOpen(false)}>
                                                    View in Relationship Hub
                                                </Link>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <AccountMenu username={username} email={email} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveAction} buttonClassName="h-9 w-9" />
                </div>
            </div>
        </header>

        <aside data-workspace-sidebar aria-hidden={!sidebarOpen} className={`fixed left-0 top-14 z-40 h-[calc(100vh-3.5rem)] w-72 border-r border-neutral-800 bg-neutral-950 ${sidebarTransitionEnabled ? "transition-transform duration-200 ease-out" : ""} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <nav className="flex h-full flex-col gap-2 px-4 py-5 md:gap-1 md:px-3 md:py-4">
                {sidebarItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href === `/${workspace.slug}` && pathname === "/admin")
                    return (
                        <Link key={item.label} href={item.href} onClick={closeSidebarAfterNavigation} className={`flex min-h-12 items-center gap-3 rounded-lg px-4 text-base transition md:min-h-10 md:px-3 md:text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-400 hover:bg-neutral-900/70 hover:text-white"}`}>
                            <span className="shrink-0">{item.icon}</span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {"meta" in item && item.meta && <span className="shrink-0 font-mono text-[11px] text-neutral-500">{item.meta}</span>}
                        </Link>
                    )
                })}
            </nav>
        </aside>
        <div className="h-14" />
    </>
}
