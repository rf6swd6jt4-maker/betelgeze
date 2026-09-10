import type { RelationshipBackgroundCommand, RelationshipBackgroundResult, RelationshipDraft } from "./relationship-draft-command"
import { recordVersionAfter, recordVersionKey } from "./record-version.js"

type Pending = { requestId: string; version: string; values: RelationshipBackgroundCommand["values"]; transport: "command" | "action" }
export type PersistedRelationshipDraft = { version: string; baseline: RelationshipDraft; draft: RelationshipDraft; pending?: Pending; conflict: boolean }
export type RelationshipDraftSnapshot = PersistedRelationshipDraft & { saving: boolean; error: string | null; storageError: string | null; latest: { version: string; draft: RelationshipDraft } | null }
type Storage = { read(): PersistedRelationshipDraft | null; write(value: PersistedRelationshipDraft | null): void }
const backgroundFields = ["primaryPersonName", "businessName", "primaryContactRole", "primaryPhone", "whatsappPhone", "communicationPrimaryProvider", "communicationDeliveryMode", "primaryEmail", "description"] as const
const relationshipBackgroundValues = (draft: RelationshipDraft) => Object.fromEntries(backgroundFields.map((field) => [field, draft[field]])) as RelationshipBackgroundCommand["values"]
const key = (draft: RelationshipDraft) => JSON.stringify(relationshipBackgroundValues(draft))
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/** A record's background queue and explicit commercial draft have one owner. */
export class RelationshipDraftQueue {
    private state: RelationshipDraftSnapshot
    private listeners = new Set<() => void>()
    private storage: Storage | null = null
    private running: Promise<boolean> | null = null
    private timer: ReturnType<typeof setTimeout> | null = null
    private stopped = false
    private held = false
    private send: (command: Pending) => Promise<RelationshipBackgroundResult>
    private transport: "action" | "command"
    private delay: number
    constructor(draft: RelationshipDraft, version: string, send: (command: Pending) => Promise<RelationshipBackgroundResult>, transport: "action" | "command" = "command", delay = 800) {
        this.send = send
        this.transport = transport
        this.delay = delay
        this.state = { draft, baseline: draft, version, saving: false, error: null, storageError: null, conflict: false, latest: null }
    }
    getSnapshot = () => this.state
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
    isDirty = () => !same(this.state.draft, this.state.baseline) || Boolean(this.state.pending)
    private persist() {
        if (this.stopped || !this.storage) return false
        try {
            const { version, baseline, draft, pending, conflict } = this.state
            this.storage.write(this.isDirty() ? { version, baseline, draft, pending, conflict } : null)
            this.state = { ...this.state, storageError: null }
            return true
        } catch { this.state = { ...this.state, storageError: "Device storage is unavailable. Keep this page open until your changes save." }; return false }
    }
    private publish(patch: Partial<RelationshipDraftSnapshot>) {
        if (this.stopped) return
        this.state = { ...this.state, ...patch }
        if (this.storage) this.persist()
        this.listeners.forEach((listener) => listener())
    }
    checkpoint = () => !this.isDirty() || this.persist()
    // Feature rollback affects future requests; an uncertain request keeps its
    // original transport until its acknowledgement has been recovered.
    setTransport(transport: "action" | "command") { this.transport = transport }
    attachStorage(storage: Storage) {
        if (this.storage || this.stopped) return
        this.storage = storage
        try {
            const saved = storage.read()
            if (!saved) return
            const current = { version: this.state.version, draft: this.state.baseline }
            const versionChanged = recordVersionKey(saved.version) !== recordVersionKey(current.version)
            const conflict = saved.conflict || (!saved.pending && versionChanged)
            this.publish({ ...saved, conflict, latest: conflict || versionChanged ? current : null, error: conflict ? "A saved draft or newer relationship version is available. Your edits are preserved; review the latest values before retrying." : null })
            if (!conflict) void this.flush()
        } catch {
            // Do not overwrite a record that could not be parsed/read.
            this.storage = null
            this.state = { ...this.state, storageError: "Your saved relationship draft could not be restored. Keep this page open." }
            this.listeners.forEach((listener) => listener())
        }
    }
    edit = (change: RelationshipDraft | ((draft: RelationshipDraft) => RelationshipDraft)) => {
        if (this.stopped) return
        this.publish({ draft: typeof change === "function" ? change(this.state.draft) : change, ...(!this.state.conflict ? { error: null } : {}) })
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delay)
    }
    receive(draft: RelationshipDraft, version: string) {
        if (this.stopped || !recordVersionAfter(version, this.state.version)) return
        const latest = { draft, version }
        if (this.state.saving || this.state.pending) { this.publish({ latest }); return }
        if (this.isDirty()) this.publish({ latest, conflict: true, error: "This relationship changed elsewhere. Your edits are preserved; review the latest values before saving them." })
        else this.publish({ draft, baseline: draft, version, latest: null })
    }
    resolveConflict(keepChanges: boolean) {
        if (!this.state.latest || this.state.saving) return false
        const { draft: latest, version } = this.state.latest
        const dirty = Object.fromEntries(Object.entries(this.state.draft).filter(([field, value]) => !same(value, this.state.baseline[field as keyof RelationshipDraft])))
        this.publish({ baseline: latest, draft: keepChanges ? { ...latest, ...dirty } : latest, version, conflict: false, pending: undefined, error: null, latest: null })
        if (keepChanges) void this.flush()
        return true
    }
    /** Explicit commercial save acknowledged; newer typing remains in the draft. */
    acknowledgeCommercial(source: RelationshipDraft, version: string) {
        if (this.state.saving || this.state.pending) return false
        this.publish({ baseline: source, version, error: null, conflict: false, latest: null })
        return true
    }
    hold() {
        if (this.held || this.state.saving || this.state.pending) return null
        this.held = true
        return () => { this.held = false; void this.flush() }
    }
    advanceVersion(version: string) { if (!this.state.saving && !this.state.pending) this.publish({ version }) }
    async flush(): Promise<boolean> {
        if (this.stopped || this.held) return false
        if (this.running) return this.running
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.running = this.drain().finally(() => { this.running = null })
        return this.running
    }
    private async drain() {
        while (!this.stopped) {
            if (this.state.conflict) return false
            if (!this.state.pending && key(this.state.draft) === key(this.state.baseline)) return true
            if (!this.state.pending && !this.state.draft.primaryPersonName.trim()) { this.publish({ error: "Add the client's name before saving the relationship." }); return false }
            const pending = this.state.pending ?? { requestId: crypto.randomUUID(), version: this.state.version, values: relationshipBackgroundValues(this.state.draft), transport: this.transport }
            this.publish({ pending, saving: true, error: null })
            try {
                const result = await this.send(pending)
                if (this.stopped) return false
                if (!result.ok) {
                    this.publish({ pending: undefined, saving: false, conflict: Boolean(result.conflict), error: result.error })
                    return false
                }
                const newerAuthority = Boolean((result.currentVersion && recordVersionKey(result.currentVersion) !== recordVersionKey(result.version)) || (this.state.latest && recordVersionAfter(this.state.latest.version, result.version)))
                const baseline = { ...this.state.baseline, ...pending.values }
                const draft = { ...this.state.draft }
                const confirmed = newerAuthority ? pending.values : result.values
                // Normalize only fields untouched since this request began.
                for (const field of Object.keys(pending.values) as Array<keyof typeof pending.values>) {
                    if (draft[field] === pending.values[field]) (draft as Record<string, unknown>)[field] = confirmed[field]
                    Object.assign(baseline, { [field]: confirmed[field] })
                }
                this.publish({ baseline, draft, version: result.version, pending: undefined, saving: false,
                    ...(newerAuthority ? { conflict: true, error: "Your save was accepted, then this relationship changed again. Refresh to review before sending further edits." } : { latest: null }),
                })
                if (newerAuthority) return false
            } catch (error) {
                this.publish({ saving: false, error: error instanceof Error ? error.message : "The save could not be confirmed. Your draft is preserved for retry." })
                return false
            }
        }
        return false
    }
    stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.storage = null; this.listeners.clear() }
}
