type RecordVersion = { updated_at: string; workflow_status: "draft" | "submitted" }
type SaveResult<T> = { ok: true; data?: T } | { ok: false; error: string; conflict?: boolean; fieldErrors?: Record<string, string> }
export type PersistedAppointmentDraft<F extends string> = { version: string; changes: Partial<Record<F, string>>; conflict: boolean }
type DraftStorage<F extends string> = { read: () => PersistedAppointmentDraft<F> | null; write: (draft: PersistedAppointmentDraft<F> | null) => void }

export type DraftSnapshot<T, F extends string> = {
    record: T
    changes: Partial<Record<F, string>>
    inputValues: Partial<Record<F, string>>
    saving: boolean
    error: string | null
    fieldErrors: Record<string, string>
    conflict: boolean
    storageError?: string | null
}

// One serial queue per appointment. Edits made during a request remain buffered;
// the next request always uses the version returned by the previous save.
export class AppointmentDraftQueue<T extends RecordVersion, F extends string> {
    private snapshot: DraftSnapshot<T, F>
    private listeners = new Set<() => void>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private running: Promise<boolean> | null = null
    private save: (record: T, changes: Partial<Record<F, string>>) => Promise<SaveResult<T>>
    private delay: number
    private focusedField: F | null = null
    private storage: DraftStorage<F> | null = null

    constructor(record: T, save: (record: T, changes: Partial<Record<F, string>>) => Promise<SaveResult<T>>, delay = 500) {
        this.snapshot = { record, changes: {}, inputValues: {}, saving: false, error: null, fieldErrors: {}, conflict: false }
        this.save = save
        this.delay = delay
    }

    getSnapshot = () => this.snapshot
    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }

    private publish(patch: Partial<DraftSnapshot<T, F>>) {
        this.snapshot = { ...this.snapshot, ...patch }
        if (this.storage) {
            try {
                this.storage.write(Object.keys(this.snapshot.changes).length ? { version: this.snapshot.record.updated_at, changes: this.snapshot.changes, conflict: this.snapshot.conflict } : null)
                this.snapshot.storageError = null
            } catch { this.snapshot.storageError = "Device storage is unavailable. Keep this page open until your changes save." }
        }
        for (const listener of this.listeners) listener()
    }

    attachStorage(storage: DraftStorage<F>) {
        this.storage = storage
        try {
            const saved = storage.read()
            if (!saved || !Object.keys(saved.changes).length) return
            const conflict = saved.conflict || saved.version !== this.snapshot.record.updated_at || this.snapshot.record.workflow_status !== "draft"
            this.publish({ changes: { ...saved.changes, ...this.snapshot.changes }, conflict,
                error: conflict ? "This draft changed while you were away. Review the saved values before sending your recovered changes." : null })
            if (!conflict) void this.flush()
        } catch { this.publish({ storageError: "Could not restore the saved draft from this device." }) }
    }

    edit(field: F, value: string) {
        if (this.snapshot.record.workflow_status !== "draft") return
        this.publish({ changes: { ...this.snapshot.changes, [field]: value }, ...(this.focusedField === field ? { inputValues: { [field]: value } as Partial<Record<F, string>> } : {}), ...(!this.snapshot.conflict ? { error: null, fieldErrors: {} } : {}) })
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delay)
    }

    focus(field: F) { this.focusedField = field }

    blur() {
        this.focusedField = null
        this.publish({ inputValues: {} })
    }

    receive(record: T) {
        // A read started before this save must not replace its newer result.
        if (this.snapshot.saving || record.updated_at <= this.snapshot.record.updated_at) return
        const dirty = Object.keys(this.snapshot.changes).length > 0 || Object.keys(this.snapshot.inputValues).length > 0
        this.publish({ record, ...(dirty ? { conflict: true, error: record.workflow_status === "submitted" ? "This appointment was submitted elsewhere. Your unsaved text is preserved below." : "This draft changed elsewhere. Review the latest saved values before saving your changes." } : {}) })
    }

    markUnavailable() {
        this.publish({ conflict: true, error: "This draft is no longer available. Your unsaved text is preserved here; copy it before leaving." })
    }

    async retry() {
        if (this.snapshot.conflict) return false
        this.publish({ error: null, fieldErrors: {} })
        return this.flush()
    }

    async keepChangesAfterReview(record: T) {
        if (record.workflow_status !== "draft") return false
        this.publish({ record, conflict: false, error: null, fieldErrors: {} })
        return this.flush()
    }

    discardChanges(record: T) {
        if (this.snapshot.saving) return
        if (this.timer) clearTimeout(this.timer)
        this.publish({ record, changes: {}, inputValues: {}, error: null, fieldErrors: {}, conflict: false })
    }

    async flush(): Promise<boolean> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null }
        if (this.running) return this.running
        if (this.snapshot.error || this.snapshot.conflict) return false
        this.running = this.drain()
        try { return await this.running } finally { this.running = null }
    }

    private async drain() {
        while (Object.keys(this.snapshot.changes).length) {
            if (this.snapshot.record.workflow_status !== "draft") return false
            const changes = { ...this.snapshot.changes }
            this.publish({ saving: true })
            try {
                const result = await this.save(this.snapshot.record, changes)
                if (!result.ok || !result.data) {
                    this.publish({ saving: false, error: result.ok ? "The save could not be confirmed. Retry your changes." : result.error, conflict: !result.ok && Boolean(result.conflict), fieldErrors: !result.ok ? result.fieldErrors ?? {} : {} })
                    return false
                }
                const remaining = { ...this.snapshot.changes }
                for (const field of Object.keys(changes) as F[]) {
                    if (remaining[field] === changes[field]) delete remaining[field]
                }
                this.publish({ record: result.data, changes: remaining, saving: false, error: null, fieldErrors: {} })
            } catch (error) {
                this.publish({ saving: false, error: error instanceof Error ? error.message : "Could not save. Your changes are preserved; retry when connected." })
                return false
            }
        }
        return true
    }
}
