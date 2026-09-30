export type WorkspaceSearchResult = {
    id: string
    type: string
    label: string
    description: string
    href: string
    path?: string
    recordId?: string
    archived?: boolean
    matchReason?: string
}

export type WorkspaceSearchInput = {
    scope: string
    userId: string
    workspaceId: string
    workspaceSlug: string
    query: string
    open: boolean
}

export type WorkspaceSearchState = {
    key: string
    scope: string
    query: string
    status: "idle" | "loading" | "results" | "empty" | "error"
    results: WorkspaceSearchResult[]
    selectedIndex: number
    error: string | null
}
export type WorkspaceSearchKey = "ArrowDown" | "ArrowUp" | "Home" | "End"
export const WORKSPACE_SEARCH_DEBOUNCE_MS = 180
export const WORKSPACE_SEARCH_DEADLINE_MS = 30_000

function inputKey(input: WorkspaceSearchInput) {
    return JSON.stringify([input.scope, input.userId, input.workspaceId, input.workspaceSlug, input.query, input.open])
}
function pendingState(input: WorkspaceSearchInput): WorkspaceSearchState {
    const length = input.query.trim().length
    return { key: inputKey(input), scope: input.scope, query: input.query,
        status: !input.open || length < 2 ? "idle" : length > 200 ? "error" : "loading",
        results: [], selectedIndex: 0, error: length > 200 ? "Keep your search to 200 characters." : null }
}
const initialState: WorkspaceSearchState = { key: "", scope: "", query: "", status: "idle", results: [], selectedIndex: 0, error: null }

// Mask old state during the render before the input effect runs.
export function workspaceSearchState(state: WorkspaceSearchState, input: WorkspaceSearchInput) {
    return state.key === inputKey(input) ? state : pendingState(input)
}
function safeHref(value: unknown, slug: string): value is string {
    if (typeof value !== "string" || !value.startsWith(`/${slug}/`) || value.includes("\\")) return false
    const url = new URL(value, "https://workspace.invalid")
    return url.origin === "https://workspace.invalid" && url.pathname.startsWith(`/${slug}/`)
}
function readResults(payload: unknown, input: WorkspaceSearchInput): WorkspaceSearchResult[] {
    const value = payload as { results?: unknown; scope?: { userId?: unknown; workspaceId?: unknown } } | null
    if (value?.scope?.userId !== input.userId || value.scope.workspaceId !== input.workspaceId) throw new Error("session")
    if (!Array.isArray(value.results) || value.results.length > 20) throw new Error("payload")
    const ids = new Set<string>()
    return value.results.map((item: unknown) => {
        const row = item as WorkspaceSearchResult | null
        if (!row || ![row.id, row.type, row.label, row.description].every((field) => typeof field === "string")
            || !safeHref(row.href, input.workspaceSlug)
            || ![row.path, row.recordId].every((field) => field === undefined || typeof field === "string")
            || (row.archived !== undefined && typeof row.archived !== "boolean")
            || (row.matchReason !== undefined && (typeof row.matchReason !== "string" || !row.matchReason.trim() || row.matchReason.length > 200))
            || ids.has(row.id)) throw new Error("payload")
        ids.add(row.id)
        return row
    })
}

export function createWorkspaceSearchController(options: { fetch?: typeof fetch; debounceMs?: number; deadlineMs?: number; now?: () => number } = {}) {
    const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    const now = options.now ?? Date.now
    const listeners = new Set<() => void>()
    let state = initialState
    let current: WorkspaceSearchInput | null = null
    let blockedScope: string | null = null
    let sequence = 0
    let debounce: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | null = null
    function publish(next: WorkspaceSearchState) { state = next; for (const listener of listeners) listener() }
    function cancel() {
        sequence += 1
        clearTimeout(debounce)
        clearTimeout(deadline)
        request?.abort()
        request = null
    }
    function start(input: WorkspaceSearchInput, delay: number) {
        cancel()
        current = input
        const pending = pendingState(input)
        if (blockedScope === input.scope) {
            publish({ ...pending, status: "error", error: "Your session changed. Reload the workspace to search." })
            return
        }
        blockedScope = null
        publish(pending)
        if (pending.status !== "loading") return
        const identity = sequence
        debounce = setTimeout(async () => {
            const controller = new AbortController()
            request = controller
            const startedAt = now()
            const deadlineMs = options.deadlineMs ?? WORKSPACE_SEARCH_DEADLINE_MS
            const isCurrent = () => identity === sequence && !controller.signal.aborted
            const expire = () => {
                if (!isCurrent()) return
                cancel()
                publish({ ...pending, status: "error", error: "Search took too long. Try again." })
            }
            const canPublish = () => {
                if (!isCurrent()) return false
                // Timers can be delayed while a browser is suspended. A late
                // response still expires before either headers or JSON publish.
                if (now() - startedAt >= deadlineMs) { expire(); return false }
                return true
            }
            deadline = setTimeout(expire, deadlineMs)
            try {
                const response = await fetcher(`/api/workspaces/${encodeURIComponent(input.workspaceSlug)}/search?q=${encodeURIComponent(input.query.trim())}`, {
                    signal: controller.signal, cache: "no-store", credentials: "same-origin",
                })
                if (!canPublish()) return
                if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "session" : response.status === 400 ? "query" : response.status === 504 ? "timeout" : "unavailable")
                const payload: unknown = await response.json()
                if (!canPublish()) return
                const results = readResults(payload, input)
                publish({ ...pending, status: results.length ? "results" : "empty", results })
            } catch (error) {
                if (!canPublish()) return
                const reason = error instanceof Error ? error.message : "unavailable"
                if (reason === "session") blockedScope = input.scope
                publish({ ...pending, status: "error", error: reason === "session" ? "Your session or access changed. Reload the workspace to search."
                    : reason === "query" ? "Check your search and try again." : reason === "timeout" ? "Search took too long. Try again." : "Search is unavailable. Try again." })
            } finally {
                // An old catch/finally must never change the newer request or timer.
                if (identity === sequence) { clearTimeout(deadline); request = null }
            }
        }, delay)
    }
    return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        getSnapshot: () => state,
        update(input: WorkspaceSearchInput) { if (!current || inputKey(input) !== inputKey(current)) start(input, options.debounceMs ?? WORKSPACE_SEARCH_DEBOUNCE_MS) },
        retry() { if (current && current.open && blockedScope !== current.scope) start(current, 0) },
        moveSelection(key: WorkspaceSearchKey) {
            if (state.status !== "results") return
            const count = state.results.length
            const selectedIndex = key === "Home" ? 0 : key === "End" ? count - 1 : (state.selectedIndex + (key === "ArrowDown" ? 1 : -1) + count) % count
            publish({ ...state, selectedIndex })
        },
        selected(input: WorkspaceSearchInput, id?: string) {
            if (!input.open || state.key !== inputKey(input) || state.status !== "results") return null
            return (id === undefined ? state.results[state.selectedIndex] : state.results.find((item) => item.id === id)) ?? null
        },
        invalidate() {
            cancel()
            if (current) { blockedScope = current.scope; publish({ ...pendingState(current), status: "error", error: "Your session changed. Reload the workspace to search." }) }
        },
        dispose() { cancel(); current = null },
    }
}
