/** Optional shell chrome/restore metadata only. Never use for drafts or commands. */
export function createWorkspaceShellStorage(storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">, report: () => void = () => {}) {
    const memory = new Map<string, string | null>()
    let failed = false
    const unavailable = () => { if (!failed) { failed = true; report() } }
    return {
        get(key: string) {
            if (memory.has(key)) return memory.get(key) ?? null
            if (failed) return null
            try { return storage().getItem(key) } catch { unavailable(); return null }
        },
        set(key: string, value: string) {
            memory.set(key, value)
            if (failed) return
            try { storage().setItem(key, value) } catch { unavailable() }
        },
        remove(key: string) {
            memory.delete(key)
            if (failed) return
            try { storage().removeItem(key) } catch { unavailable() }
        },
    }
}
