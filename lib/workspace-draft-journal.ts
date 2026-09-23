export type WorkspaceDraftScope = { userId: string; workspaceSlug: string; recordType: string; recordId: string; field: string }
export type WorkspaceDraftValue = { value: string; baseline: string; version: string }
export type WorkspaceRecoveredDraft = WorkspaceDraftValue & { id: string; savedAt: number; durable: boolean }
type JournalRecord = WorkspaceDraftValue & { format: 1; savedAt: number }
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

// Dirty owners outlive a streamed route's React tree. Storage failure cannot
// erase their only copy while this document remains alive.
const retained = new Map<string, JournalRecord>()
const same = (a: WorkspaceDraftValue | null, b: WorkspaceDraftValue) => a?.value === b.value && a.baseline === b.baseline && a.version === b.version
const dirty = (value: WorkspaceDraftValue) => value.value !== value.baseline
export function workspaceDraftJournalPrefix(scope: WorkspaceDraftScope) {
    return `betelgeze:record-draft:v1:${[scope.userId, scope.workspaceSlug, scope.recordType, scope.recordId, scope.field].map(encodeURIComponent).join(":")}:`
}

/** No storage work on ordinary input. Call only at an explicit checkpoint. */
export function createWorkspaceDraftJournal(scope: WorkspaceDraftScope, options: { storage?: () => StoragePort; maximum?: number; writer?: () => string; yieldTask?: () => Promise<void> } = {}) {
    const prefix = workspaceDraftJournalPrefix(scope)
    const storage = options.storage ?? (() => window.localStorage)
    const newWriter = options.writer ?? (() => crypto.randomUUID())
    const maximum = options.maximum ?? 100_000
    const yieldTask = options.yieldTask ?? (() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
    // Never inherit writer ownership from sessionStorage: duplicated browser
    // tabs inherit that storage and must not overwrite each other's journals.
    let ownKey = `${prefix}${newWriter()}`
    let written: WorkspaceDraftValue | null = null
    let hintWritten = false
    let active = true
    let error: string | null = null
    let recovery = false
    const listeners = new Set<() => void>()
    const markRecovery = () => { if (!recovery) { recovery = true; listeners.forEach((listener) => listener()) } }
    function checkpoint(value: WorkspaceDraftValue) {
        if (!dirty(value)) return true
        if (!active) return same(written, value)
        if (same(written, value)) { retained.delete(ownKey); return true }
        const previous = retained.get(ownKey)
        const record: JournalRecord = { ...value, format: 1, savedAt: same(previous ?? null, value) ? previous!.savedAt : Date.now() }
        retained.set(ownKey, record)
        markRecovery()
        if (value.value.length > maximum || value.baseline.length > maximum) {
            error = "This draft is too large for device recovery. Keep this page open until it saves."
            return false
        }
        try {
            const store = storage()
            // This hint is never cleared: a racing writer may own another copy.
            if (!hintWritten) { store.setItem(`${prefix}hint`, "1"); hintWritten = true }
            store.setItem(ownKey, JSON.stringify(record))
            written = value
            retained.delete(ownKey)
            error = null
            return true
        } catch {
            error = "Device storage is unavailable. This draft is retained in the open page; keep it open until the changes save."
            return false
        }
    }
    function decode(id: string, raw: string): WorkspaceRecoveredDraft | null {
        // Preserve malformed/oversized entries without parsing unbounded data.
        if (raw.length > maximum * 12 + 2048) return null
        const row = JSON.parse(raw) as Partial<JournalRecord>
        if (row.format !== 1 || typeof row.value !== "string" || typeof row.baseline !== "string" || typeof row.version !== "string" || row.version.length > 400 || typeof row.savedAt !== "number" || !Number.isFinite(row.savedAt) || row.value.length > maximum || row.baseline.length > maximum) return null
        return { id, value: row.value, baseline: row.baseline, version: row.version, savedAt: row.savedAt, durable: true }
    }
    return {
        userId: scope.userId,
        scopeKey: prefix,
        checkpoint,
        start() { active = true },
        active: () => active,
        error: () => error,
        stop() { active = false },
        hasRecovery: () => recovery,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        inspectRecovery() {
            if ([...retained.keys()].some((key) => key.startsWith(prefix))) markRecovery()
            try { if (storage().getItem(`${prefix}hint`) === "1") markRecovery() } catch { /* Explicit review reports storage failure. */ }
            return recovery
        },
        // Only this writer's server-acknowledged clean copy may retire. An
        // imported or malformed journal is never deleted by recovery.
        acknowledge(value: WorkspaceDraftValue) {
            if (!active) return
            if (dirty(value)) { if (written || retained.has(ownKey)) checkpoint(value); return }
            retained.delete(ownKey)
            if (written) {
                try { storage().removeItem(ownKey); written = null; error = null } catch { /* A stale recovery copy is safer than dropping another writer. */ }
            }
        },
        archive(value: WorkspaceDraftValue) {
            checkpoint(value)
            ownKey = `${prefix}${newWriter()}`
            written = null
        },
        async review(signal?: AbortSignal) {
            const found = new Map<string, WorkspaceRecoveredDraft>()
            let unreadable = 0
            try {
                const store = storage()
                // Enumeration is explicit recovery work, never a mount/typing
                // path. Yield every 25 keys so a large origin cannot monopolize UI.
                const initialLength = store.length
                for (let index = 0; index < initialLength; index++) {
                    if (signal?.aborted) throw new DOMException("Recovery cancelled", "AbortError")
                    const key = store.key(index)
                    if (key?.startsWith(prefix) && key !== `${prefix}hint`) {
                        try {
                            const raw = store.getItem(key)
                            if (raw !== null) { const row = decode(key, raw); if (row) found.set(key, row); else unreadable++ }
                        } catch { unreadable++ }
                    }
                    if ((index + 1) % 25 === 0) await yieldTask()
                }
            } catch (failure) {
                if (signal?.aborted) throw failure
                unreadable++
            }
            for (const [id, value] of retained) if (id.startsWith(prefix)) {
                const stored = found.get(id)
                found.set(id, { ...value, id, durable: Boolean(stored && same(stored, value)) })
            }
            return { drafts: [...found.values()].sort((a, b) => b.savedAt - a.savedAt), error: unreadable ? "Some device drafts could not be read. They have been left untouched." : null }
        },
    }
}

export type WorkspaceDraftJournal = ReturnType<typeof createWorkspaceDraftJournal>
