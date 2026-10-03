import { WorkspaceRecordCache } from "@/lib/workspace-record-cache"
import { recordReferenceKey, type RecordReference, type RecordReferenceResult, type ReferenceContext } from "@/lib/communications/references"
import { readReferenceResults } from "@/lib/communications/reference-results"

type ResolvedReference = { reference: RecordReferenceResult | null }
type Pending = { reference: RecordReference; resolve: (value: ResolvedReference) => void; reject: (error: unknown) => void; signal: AbortSignal }

/** One bounded resolver per active conversation; the shared cache owns snapshots and cancellation. */
export class MessageReferenceResolver {
    readonly cache = new WorkspaceRecordCache<ResolvedReference>(128)
    private pending = new Map<string, Pending>()
    private controller: AbortController | null = null
    private activeRun: object | null = null
    private activeBatch: Pending[] = []
    private scheduled = false
    private enabled = false
    private generation = 0
    constructor(readonly context: ReferenceContext, private readonly request: typeof fetch = fetch) {}
    setActive(active: boolean) {
        if (active === this.enabled) return
        this.enabled = active
        if (!active) this.clear()
    }
    clear() {
        this.generation++
        this.controller?.abort()
        this.controller = null
        this.activeRun = null
        const cancelled = new DOMException("Reference lookup cancelled", "AbortError")
        for (const item of [...this.pending.values(), ...this.activeBatch]) item.reject(cancelled)
        this.pending.clear()
        this.activeBatch = []
        this.cache.clear()
    }
    remember(reference: RecordReferenceResult) {
        if (!this.enabled) return
        const key = recordReferenceKey(reference)
        this.cache.invalidate(candidate => candidate === key)
        void this.cache.load(key, async () => ({ reference }), { force: true }).catch(() => undefined)
    }
    resolve(reference: RecordReference) {
        if (!this.enabled) return
        const key = recordReferenceKey(reference)
        const snapshot = this.cache.getSnapshot(key)
        // Failures remain visible until an explicit retry, focus or tab reactivation.
        if (snapshot.error) return
        void this.cache.load(key, signal => new Promise<ResolvedReference>((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException("Reference lookup cancelled", "AbortError")); return }
            const item: Pending = {
                reference, signal,
                resolve: value => { signal.removeEventListener("abort", cancel); resolve(value) },
                reject: error => { signal.removeEventListener("abort", cancel); reject(error) },
            }
            const cancel = () => {
                if (this.pending.get(key) === item) this.pending.delete(key)
                item.reject(new DOMException("Reference lookup cancelled", "AbortError"))
            }
            signal.addEventListener("abort", cancel, { once: true })
            this.pending.set(key, item)
            if (!this.scheduled) {
                this.scheduled = true
                queueMicrotask(() => { this.scheduled = false; void this.flush() })
            }
        }), { maxAge: 30_000, timeoutMs: 10_000, discardDataOnError: () => true }).catch(() => undefined)
    }
    private async flush() {
        if (this.activeRun || !this.enabled) return
        const run = {}
        this.activeRun = run
        try {
            while (this.enabled && this.activeRun === run && this.pending.size) {
                const batch = [...this.pending.entries()].slice(0, 40)
                for (const [key] of batch) this.pending.delete(key)
                const live = batch.filter(([, item]) => !item.signal.aborted)
                if (!live.length) continue
                const generation = this.generation
                const controller = new AbortController()
                this.controller = controller
                this.activeBatch = live.map(([, item]) => item)
                let abortRead!: () => void
                const cancelled = new Promise<never>((_, reject) => {
                    abortRead = () => reject(controller.signal.reason ?? new DOMException("Reference lookup cancelled", "AbortError"))
                    controller.signal.addEventListener("abort", abortRead, { once: true })
                })
                const timer = setTimeout(() => controller.abort(new Error("Reference check took too long. Return to this chat to retry.")), 8_000)
                try {
                    // Race the entire transport AND body parser. A fetch mock,
                    // service worker or stalled body may ignore abort entirely.
                    const read = Promise.resolve().then(async () => {
                        controller.signal.throwIfAborted()
                        const response = await this.request(`/api/workspaces/${encodeURIComponent(this.context.workspaceSlug)}/communications/native/references`, {
                            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal,
                            body: JSON.stringify({ conversationId: this.context.conversationId, references: live.map(([, item]) => item.reference) }),
                        })
                        if (!response.ok) throw new Error("Could not check reference")
                        return response.json()
                    })
                    const data = await Promise.race([read, cancelled])
                    if (generation !== this.generation || controller.signal.aborted) throw new DOMException("Reference lookup cancelled", "AbortError")
                    const results = new Map(readReferenceResults(data, this.context, 40, live.map(([, item]) => item.reference)).map(result => [recordReferenceKey(result), result]))
                    for (const [key, item] of live) item.resolve({ reference: results.get(key) ?? null })
                } catch (error) {
                    for (const [, item] of live) item.reject(error instanceof Error ? error : new Error("Could not check reference"))
                } finally {
                    clearTimeout(timer)
                    controller.signal.removeEventListener("abort", abortRead)
                    if (this.controller === controller) this.controller = null
                    if (this.activeRun === run) this.activeBatch = []
                }
            }
        } finally { if (this.activeRun === run) this.activeRun = null }
    }
}
