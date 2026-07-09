"use client"

/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AccountMenu } from "@/components/account/AccountMenu"
import { LEADGEN_POLLING_SYSTEM_VERSION_LABEL } from "@/lib/leadgen/version"

const historyKey = "betelgeze:workspace-history"
const sidebarStorageKey = "betelgeze:workspace-sidebar-open"

type WorkspaceHistoryState = {
    stack: string[]
    index: number
}

type WorkspaceTab = {
    id: string
    title: string
    url: string
    scrollY?: number
}

type WorkspaceTabsState = {
    activeId: string
    tabs: WorkspaceTab[]
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

function createTabId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function deferNavigationStateUpdate(update: () => void) {
    queueMicrotask(update)
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
    const activeTabIdRef = useRef("")
    const tabsBootstrappedRef = useRef(false)
    const pendingTabScrollRef = useRef<{ tabId: string; url: string; scrollY: number } | null>(null)
    const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [sidebarHydrated, setSidebarHydrated] = useState(false)
    const [sidebarTransitionEnabled, setSidebarTransitionEnabled] = useState(false)
    const [tabsHydrated, setTabsHydrated] = useState(false)
    const [tabs, setTabs] = useState<WorkspaceTab[]>([])
    const [activeTabId, setActiveTabId] = useState("")
    const [canGoBack, setCanGoBack] = useState(false)
    const [canGoForward, setCanGoForward] = useState(false)
    const [query, setQuery] = useState("")
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])
    const [searchShortcutLabel, setSearchShortcutLabel] = useState("Ctrl+J")
    const defaultWorkspaceUrl = `/${workspace.slug}`
    const tabsStorageKey = `betelgeze:workspace-tabs:${workspace.slug}`

    const normalizeWorkspaceUrl = useCallback((value: string) => {
        const parsed = new URL(value, window.location.origin)
        const search = parsed.search
        const path = parsed.pathname
        const adminMatch = path.match(/^\/admin(?:\/(.*))?$/)
        const dashboardMatch = path.match(new RegExp(`^/dashboard/${workspace.slug}(?:/(.*))?$`, "i"))
        const leadgenMatch = path.match(new RegExp(`^/leadgen/${workspace.slug}(?:/(.*))?$`, "i"))

        if (adminMatch) {
            const suffix = adminMatch[1] ?? ""
            if (!suffix) return `${defaultWorkspaceUrl}${search}`
            if (suffix === "new") return `${defaultWorkspaceUrl}/clients/new${search}`
            if (suffix === "health") return `${defaultWorkspaceUrl}/health${search}`
            if (suffix === "invoices") return `${defaultWorkspaceUrl}/invoices${search}`
            if (suffix === "sales/new") return `${defaultWorkspaceUrl}/sales/new${search}`
            if (suffix.startsWith("client/")) return `${defaultWorkspaceUrl}/clients/${suffix.slice("client/".length)}${search}`
            return `${defaultWorkspaceUrl}/${suffix}${search}`
        }

        if (dashboardMatch) return `${defaultWorkspaceUrl}${dashboardMatch[1] ? `/${dashboardMatch[1]}` : ""}${search}`
        if (leadgenMatch) return `${defaultWorkspaceUrl}/leadgen${leadgenMatch[1] ? `/${leadgenMatch[1]}` : ""}${search}`
        return `${path}${search}`
    }, [defaultWorkspaceUrl, workspace.slug])

    const titleForUrl = useCallback((url: string) => {
        const parsed = new URL(url, window.location.origin)
        const path = parsed.pathname
        const suffix = path === defaultWorkspaceUrl
            ? ""
            : path.startsWith(`${defaultWorkspaceUrl}/`)
                ? path.slice(defaultWorkspaceUrl.length + 1)
                : path.replace(/^\//, "")

        if (!suffix) return "Onboarding"
        if (suffix === "relationships") return "Relationships"
        if (suffix.startsWith("relationships/")) return "Relationship"
        if (suffix === "work") return "Work Queue"
        if (suffix === "leadgen") return "Lead Gen"
        if (suffix === "leadgen/new") return "New Poll"
        if (suffix.startsWith("leadgen/poll/")) return "Lead Poll"
        if (suffix === "leadgen/polls") return "Polls"
        if (suffix === "clients/new") return "New Client"
        if (suffix.startsWith("clients/")) return "Client"
        if (suffix === "invoices") return "Invoices"
        if (suffix === "sales/new") return "New Invoice"
        if (suffix === "settings") return "Settings"
        if (suffix === "health") return "System Health"
        if (suffix === "users") return "Users"
        return suffix.split("/")[0]?.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Tab"
    }, [defaultWorkspaceUrl])

    const saveTabsState = useCallback((nextTabs: WorkspaceTab[], nextActiveId: string) => {
        sessionStorage.setItem(tabsStorageKey, JSON.stringify({ tabs: nextTabs, activeId: nextActiveId }))
    }, [tabsStorageKey])

    const readTabsState = useCallback((currentUrl: string): WorkspaceTabsState => {
        try {
            const stored = sessionStorage.getItem(tabsStorageKey)
            const parsed = stored ? JSON.parse(stored) as Partial<WorkspaceTabsState> : {}
            const storedTabs = Array.isArray(parsed.tabs)
                ? parsed.tabs.filter((tab): tab is WorkspaceTab => Boolean(
                    tab &&
                    typeof tab.id === "string" &&
                    typeof tab.url === "string" &&
                    typeof tab.title === "string" &&
                    (tab.scrollY === undefined || (typeof tab.scrollY === "number" && Number.isFinite(tab.scrollY)))
                ))
                : []
            const tabsToUse = storedTabs.length ? storedTabs : [{ id: createTabId(), url: currentUrl, title: titleForUrl(currentUrl) }]
            const activeId = typeof parsed.activeId === "string" && tabsToUse.some((tab) => tab.id === parsed.activeId)
                ? parsed.activeId
                : tabsToUse[0].id
            return {
                activeId,
                tabs: tabsToUse.map((tab) => tab.id === activeId ? { ...tab, url: currentUrl, title: titleForUrl(currentUrl) } : tab),
            }
        } catch {
            const tab = { id: createTabId(), url: currentUrl, title: titleForUrl(currentUrl) }
            return { activeId: tab.id, tabs: [tab] }
        }
    }, [tabsStorageKey, titleForUrl])

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
        if (tabsBootstrappedRef.current) return
        tabsBootstrappedRef.current = true
        const query = searchParams.toString()
        const current = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}`)
        const stored = readTabsState(current)
        activeTabIdRef.current = stored.activeId
        saveTabsState(stored.tabs, stored.activeId)
        deferNavigationStateUpdate(() => {
            setActiveTabId(stored.activeId)
            setTabs(stored.tabs)
            setTabsHydrated(true)
        })
    }, [normalizeWorkspaceUrl, pathname, readTabsState, saveTabsState, searchParams])

    useEffect(() => {
        activeTabIdRef.current = activeTabId
    }, [activeTabId])

    useEffect(() => {
        if (!tabsHydrated) return
        const query = searchParams.toString()
        const current = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}`)

        setTabs((existingTabs) => {
            const activeId = activeTabIdRef.current
            if (!activeId) return existingTabs
            const nextTabs = existingTabs.length ? existingTabs : [{ id: activeId || createTabId(), title: titleForUrl(current), url: current }]
            const nextActiveId = nextTabs.some((tab) => tab.id === activeId) ? activeId : nextTabs[0].id
            const updatedTabs = nextTabs.map((tab) => tab.id === nextActiveId ? { ...tab, url: current, title: titleForUrl(current) } : tab)
            activeTabIdRef.current = nextActiveId
            saveTabsState(updatedTabs, nextActiveId)
            return updatedTabs
        })
    }, [normalizeWorkspaceUrl, pathname, saveTabsState, searchParams, tabsHydrated, titleForUrl])

    useEffect(() => {
        if (!tabsHydrated || tabs.length < 2) return
        const inactiveUrls = [...new Set(tabs.filter((tab) => tab.id !== activeTabId).map((tab) => tab.url))]
        const prefetch = () => inactiveUrls.forEach((url) => router.prefetch(url))
        const idleWindow = window as unknown as {
            requestIdleCallback?: Window["requestIdleCallback"]
            cancelIdleCallback?: Window["cancelIdleCallback"]
        }

        if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
            const idleId = idleWindow.requestIdleCallback(prefetch, { timeout: 1200 })
            return () => idleWindow.cancelIdleCallback?.(idleId)
        }

        const timeoutId = window.setTimeout(prefetch, 250)
        return () => window.clearTimeout(timeoutId)
    }, [activeTabId, router, tabs, tabsHydrated])

    useEffect(() => {
        const pending = pendingTabScrollRef.current
        if (!pending || pending.tabId !== activeTabIdRef.current) return
        const query = searchParams.toString()
        const current = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}`)
        if (current !== pending.url) return

        pendingTabScrollRef.current = null
        const frame = window.requestAnimationFrame(() => window.scrollTo({ top: pending.scrollY, behavior: "instant" }))
        return () => window.cancelAnimationFrame(frame)
    }, [normalizeWorkspaceUrl, pathname, searchParams])

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

    function directSearchHref(value: string) {
        const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")
        if (normalized === "new poll" || normalized === "create poll" || normalized === "start poll" || normalized === "run poll") return `/${workspace.slug}/leadgen/new`
        if (normalized === "invoices" || normalized === "invoice") return `/${workspace.slug}/invoices`
        if (normalized === "new invoice" || normalized === "create invoice" || normalized === "send invoice") return `/${workspace.slug}/sales/new`
        if (normalized === "manual client" || normalized === "add manual client" || normalized === "new client" || normalized === "add client") return `/${workspace.slug}/clients/new`
        if (normalized === "seed sources" || normalized === "seed source category") return `/${workspace.slug}/settings#leadgen-sources-seed`
        if (normalized === "business validation" || normalized === "business validation sources") return `/${workspace.slug}/settings#leadgen-sources-business-validation`
        if (normalized === "owner identity" || normalized === "owner identity discovery" || normalized === "owner discovery") return `/${workspace.slug}/settings#leadgen-sources-owner-identity`
        if (normalized === "owner phone" || normalized === "owner phone sources" || normalized === "phone discovery") return `/${workspace.slug}/settings#leadgen-sources-owner-phone`
        if (normalized === "phone validation" || normalized === "phone validation sources") return `/${workspace.slug}/settings#leadgen-sources-phone-validation`
        return null
    }

    function submitSearch(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Enter") return
        const href = searchResults[0]?.href ?? directSearchHref(query)
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

    function prefetchTab(tab: WorkspaceTab) {
        router.prefetch(tab.url)
    }

    function switchTab(tab: WorkspaceTab) {
        if (tab.id === activeTabIdRef.current) return
        const query = searchParams.toString()
        const currentUrl = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}`)
        const nextTabs = tabs.map((existingTab) => existingTab.id === activeTabIdRef.current
            ? { ...existingTab, url: currentUrl, title: titleForUrl(currentUrl), scrollY: window.scrollY }
            : existingTab)
        activeTabIdRef.current = tab.id
        pendingTabScrollRef.current = { tabId: tab.id, url: tab.url, scrollY: tab.scrollY ?? 0 }
        setTabs(nextTabs)
        setActiveTabId(tab.id)
        saveTabsState(nextTabs, tab.id)

        if (tab.url === currentUrl) {
            pendingTabScrollRef.current = null
            window.scrollTo({ top: tab.scrollY ?? 0, behavior: "instant" })
            return
        }

        router.push(tab.url, { scroll: false })
    }

    function switchTabFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>, tabIndex: number) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return
        event.preventDefault()
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? visibleTabs.length - 1
                : (tabIndex + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length
        const nextTab = visibleTabs[nextIndex]
        tabButtonRefs.current.get(nextTab.id)?.focus()
        switchTab(nextTab)
    }

    function addTab() {
        const url = defaultWorkspaceUrl
        const tab = { id: createTabId(), title: titleForUrl(url), url }
        const nextTabs = [...tabs, tab].slice(-8)
        activeTabIdRef.current = tab.id
        setTabs(nextTabs)
        setActiveTabId(tab.id)
        saveTabsState(nextTabs, tab.id)
        if (normalizeWorkspaceUrl(`${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`) !== url) {
            router.push(url)
        } else {
            window.scrollTo({ top: 0, behavior: "instant" })
        }
    }

    function closeTab(tabId: string) {
        if (tabs.length <= 1) return
        const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
        const nextTabs = tabs.filter((tab) => tab.id !== tabId)
        const nextActiveTab = tabId === activeTabId
            ? nextTabs[Math.max(0, tabIndex - 1)] ?? nextTabs[0]
            : nextTabs.find((tab) => tab.id === activeTabId) ?? nextTabs[0]
        activeTabIdRef.current = nextActiveTab.id
        setTabs(nextTabs)
        setActiveTabId(nextActiveTab.id)
        saveTabsState(nextTabs, nextActiveTab.id)
        if (tabId === activeTabId) {
            const query = searchParams.toString()
            const currentUrl = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}`)
            if (nextActiveTab.url === currentUrl) {
                window.scrollTo({ top: nextActiveTab.scrollY ?? 0, behavior: "instant" })
            } else {
                pendingTabScrollRef.current = { tabId: nextActiveTab.id, url: nextActiveTab.url, scrollY: nextActiveTab.scrollY ?? 0 }
                router.push(nextActiveTab.url, { scroll: false })
            }
        }
    }

    const navButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-400"
    const sidebarItems = [
        { label: "Home", href: `/${workspace.slug}`, icon: <HomeIcon /> },
        { label: "Relationships", href: `/${workspace.slug}/relationships`, icon: <RelationshipsIcon /> },
        { label: "Work Queue", href: `/${workspace.slug}/work`, icon: <WorkIcon /> },
        { label: "Lead Gen", meta: LEADGEN_POLLING_SYSTEM_VERSION_LABEL, href: `/${workspace.slug}/leadgen`, icon: <LeadIcon /> },
        { label: "Onboarding", href: `/${workspace.slug}`, icon: <WorkIcon /> },
        { label: "System Health", href: `/${workspace.slug}/health`, icon: <HealthIcon /> },
        { label: "Settings", href: `/${workspace.slug}/settings`, icon: <SettingsIcon /> },
    ]

    const visibleTabs = tabsHydrated && tabs.length ? tabs : [{ id: "initial", title: titleForUrl(defaultWorkspaceUrl), url: defaultWorkspaceUrl }]

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

        <div data-workspace-tabbar className={`fixed top-14 z-40 h-11 border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/10 backdrop-blur ${sidebarTransitionEnabled ? "transition-[left,width] duration-200 ease-out" : ""}`}>
            <div role="tablist" aria-label="Workspace tabs" className="flex h-full min-w-0 items-end gap-1 overflow-x-auto px-2 pt-1">
                {visibleTabs.map((tab) => {
                    const active = tab.id === activeTabId || (!tabsHydrated && tab.id === "initial")
                    return (
                        <div key={tab.id} className={`group flex h-9 min-w-32 max-w-56 shrink-0 items-center rounded-t-lg border px-2 text-sm ${active ? "border-neutral-700 border-b-neutral-950 bg-neutral-950 text-white" : "border-transparent bg-neutral-900/55 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"}`}>
                            <button
                                ref={(node) => { if (node) tabButtonRefs.current.set(tab.id, node); else tabButtonRefs.current.delete(tab.id) }}
                                role="tab"
                                aria-selected={active}
                                tabIndex={active ? 0 : -1}
                                type="button"
                                onPointerEnter={() => prefetchTab(tab)}
                                onFocus={() => prefetchTab(tab)}
                                onKeyDown={(event) => switchTabFromKeyboard(event, visibleTabs.indexOf(tab))}
                                onClick={() => switchTab(tab)}
                                className="min-w-0 flex-1 truncate text-left"
                            >
                                {tab.title}
                            </button>
                            {visibleTabs.length > 1 && (
                                <button data-icon-button type="button" onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.title} tab`} className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 opacity-80 transition hover:bg-neutral-800 hover:text-white group-hover:opacity-100">
                                    <span aria-hidden="true" className="text-base leading-none">×</span>
                                </button>
                            )}
                        </div>
                    )
                })}
                <button data-icon-button type="button" onClick={addTab} aria-label="Open new tab" className="mb-1 ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-900 hover:text-white">
                    <span aria-hidden="true" className="text-xl leading-none">+</span>
                </button>
            </div>
        </div>

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
        <div className="h-[6.25rem]" />
    </>
}
