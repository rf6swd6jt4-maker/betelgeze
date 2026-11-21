"use client"
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { DetailField, DetailFields, touchPropertyRows } from "@/components/detail"
import { AutoGrowTextarea } from "@/components/ui"
import { saveRelationshipBackgroundDetails } from "@/app/[workspaceSlug]/relationships/actions"
import { RelationshipDraftQueue } from "@/lib/relationship-draft-queue"
import { createRelationshipDraftStorage, sendRelationshipBackgroundCommand, type RelationshipDraft } from "@/lib/relationship-draft-command"
import { getRelationshipDraftQueue, retainRelationshipDraftQueue } from "@/lib/relationship-draft-runtime"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"

type BackgroundStatus = { saving: boolean; error: string | null; storageError: string | null; conflict: boolean; hasLatest: boolean }
type BackgroundContext = {
    draft: RelationshipDraft; canEdit: boolean; update: (key: keyof RelationshipDraft, value: string) => void; flush: () => Promise<unknown>
    /** For the fields wherever they are placed: save state, and the ways out of a failed or conflicting save. */
    status: BackgroundStatus; save: () => void; refresh: () => void; resolveConflict: (keepMine: boolean) => void
}
const Context = createContext<BackgroundContext | null>(null)
export function useRelationshipBackground() { const value = useContext(Context); if (!value) throw new Error("Relationship details provider required"); return value }

const fieldClass = "min-h-9 w-full min-w-0 rounded-md bg-transparent px-1 py-1 text-base text-neutral-200 outline-none hover:bg-[var(--color-surface-hover)] focus:bg-neutral-900 disabled:opacity-70 sm:text-sm"
const TEXT_FIELDS = [
    ["primaryPersonName", "Name", "identity", "text"], ["businessName", "Company", "company", "text"],
    ["industryValue", "Industry", "company", "text"], ["websiteUrl", "Website", "source", "url"],
    ["primaryContactRole", "Contact role", "role", "text"], ["locationValue", "Location", "location", "text"],
] as const

/**
 * The client's editable details, drawing on the editor around them. `compact` is the client page's Details column:
 * one narrow column of property rows, with the notes in their own block, and a save line that speaks only when there
 * is something to say. The default is the two-column block the record page has always had.
 */
export function RelationshipBackgroundFields({ compact = false, part = "all" }: { compact?: boolean; part?: "all" | "fields" | "notes" }) {
    const { draft, canEdit, update, status, save, refresh, resolveConflict } = useRelationshipBackground()
    const inputs = TEXT_FIELDS.map(([key, label, icon, type]) => <DetailField key={key} label={label} icon={icon}><input aria-label={label} type={type} disabled={!canEdit} value={draft[key] ?? ""} onChange={event => update(key, event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }} className={fieldClass} /></DetailField>)
    const notes = <AutoGrowTextarea aria-label="Relationship notes" disabled={!canEdit} rows={3} value={draft.description} onChange={event => update("description", event.target.value)} onBlur={save} className={fieldClass} />
    const quiet = !status.error && !status.storageError && !status.saving
    const line = status.error || status.storageError || (status.saving ? "Saving details…" : canEdit ? "Details save automatically" : "Read only")
    const recovery = <>
        {status.error ? <button type="button" onClick={save} className="min-h-11 text-sm underline">Retry save</button> : null}
        {status.conflict ? <div role="alert" className="flex flex-wrap gap-3 py-2 text-sm text-amber-200"><span>Your draft is preserved. Review the latest values before saving.</span><button onClick={refresh} className="min-h-11 underline">Refresh</button>{status.hasLatest ? <><button onClick={() => resolveConflict(false)} className="min-h-11 underline">Use saved values</button><button onClick={() => resolveConflict(true)} className="min-h-11 underline">Keep my edits</button></> : null}</div> : null}
    </>
    if (compact) return <div data-client-details={part}>
        {/* Rows as tall as the plain property rows around them, with the typed value on the same edge as theirs. */}
        {part !== "notes" ? <DetailFields narrow className={`[&>div]:py-0 [&>div>div]:-ml-1 ${touchPropertyRows}`}>{inputs}</DetailFields> : null}
        {part !== "fields" ? notes : null}
        {/* The line keeps its height so nothing shifts; at rest it says nothing. */}
        {part !== "notes" ? <><p role="status" className="min-h-4 px-1 text-xs text-neutral-400">{quiet ? "" : line}</p>{recovery}</> : null}
    </div>
    return <section aria-label="Relationship information" className="mt-4 border-b border-card-border">
        <DetailFields className="!mt-0">
            {inputs}
            <DetailField multiline label="Notes" icon="description" className="lg:col-span-2">{notes}</DetailField>
        </DetailFields>
        <p role="status" className="py-2 text-xs text-neutral-400">{line}</p>
        {recovery}
    </section>
}

export function RelationshipBackgroundEditor({ workspaceSlug, relationshipId, userId, initial, updatedAt, canEdit, commandsEnabled, fields = true, children }: {
    workspaceSlug: string; relationshipId: string; userId: string; initial: RelationshipDraft; updatedAt: string; canEdit: boolean; commandsEnabled: boolean
    /** False where the page places `RelationshipBackgroundFields` itself (the client page's Details column). */
    fields?: boolean
    children?: ReactNode
}) {
    const router = useRouter()
    const runtimeKey = `${userId}:${workspaceSlug}:${relationshipId}`
    const [queue] = useState(() => getRelationshipDraftQueue(runtimeKey, () => new RelationshipDraftQueue(initial, updatedAt, async command => {
        if (!navigator.onLine) throw new Error("Saved on this device. Changes will retry when connected.")
        if (command.transport === "action") {
            const result = await runWorkspaceMutation(() => saveRelationshipBackgroundDetails(workspaceSlug, relationshipId, { ...command.values, expectedUpdatedAt: command.version, expectedUserId: userId }), { category: "services" })
            return result.ok ? { ...result, values: command.values } : result
        }
        return runWorkspaceMutation(() => sendRelationshipBackgroundCommand(workspaceSlug, relationshipId, { requestId: command.requestId, expectedUserId: userId, expectedUpdatedAt: command.version, values: command.values }), { category: "services" })
    }, commandsEnabled ? "command" : "action")))
    const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)
    useEffect(() => { queue.setTransport(commandsEnabled ? "command" : "action") }, [commandsEnabled, queue])
    useEffect(() => {
        try { queue.attachStorage(createRelationshipDraftStorage(localStorage, sessionStorage, `betelgeze:relationship-draft:${runtimeKey}`)) }
        catch { queue.attachStorage({ read: () => { throw new Error("Device storage unavailable") }, write: () => { throw new Error("Device storage unavailable") } }) }
        const release = retainRelationshipDraftQueue(runtimeKey, queue)
        const unregister = registerWorkspaceAutosaveFlusher(() => queue.flush(), { checkpoint: queue.checkpoint })
        const beforeUnload = (event: BeforeUnloadEvent) => { if (!queue.checkpoint()) { event.preventDefault(); event.returnValue = "" } }
        window.addEventListener("beforeunload", beforeUnload)
        return () => { unregister(); window.removeEventListener("beforeunload", beforeUnload); void queue.flush(); release() }
    }, [queue, runtimeKey])
    useEffect(() => { queue.receive(initial, updatedAt) }, [initial, updatedAt, queue])
    const update = <K extends keyof RelationshipDraft>(key: K, value: RelationshipDraft[K]) => queue.edit(draft => ({ ...draft, [key]: value }))
    return <Context.Provider value={{
        draft: state.draft, canEdit, update: (key, value) => update(key, value as never),
        flush: async () => { if (!await queue.flush()) throw new Error("Save or resolve the relationship details before continuing.") },
        status: { saving: state.saving, error: state.error ?? null, storageError: state.storageError ?? null, conflict: Boolean(state.conflict), hasLatest: Boolean(state.latest) },
        save: () => { void queue.flush() }, refresh: () => router.refresh(), resolveConflict: keepMine => queue.resolveConflict(keepMine),
    }}>{fields ? <RelationshipBackgroundFields /> : null}{children}</Context.Provider>
}
