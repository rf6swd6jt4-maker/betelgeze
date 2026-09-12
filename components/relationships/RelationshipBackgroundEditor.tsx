"use client"
import { useEffect, useState, useSyncExternalStore } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { CommunicationMethodSelector, Selector } from "@/components/ui"
import { saveRelationshipBackgroundDetails } from "@/app/[workspaceSlug]/relationships/actions"
import { RelationshipDraftQueue } from "@/lib/relationship-draft-queue"
import { createRelationshipDraftStorage, sendRelationshipBackgroundCommand, type RelationshipDraft } from "@/lib/relationship-draft-command"
import { getRelationshipDraftQueue, retainRelationshipDraftQueue } from "@/lib/relationship-draft-runtime"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"

export function RelationshipBackgroundEditor({ workspaceSlug, relationshipId, userId, initial, updatedAt, canEdit, commandsEnabled }: {
    workspaceSlug: string; relationshipId: string; userId: string; initial: RelationshipDraft; updatedAt: string; canEdit: boolean; commandsEnabled: boolean
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
    const fieldClass = "min-h-9 w-full min-w-0 rounded-md bg-transparent px-1 py-1 text-base text-neutral-200 outline-none hover:bg-neutral-900/60 focus:bg-neutral-900 disabled:opacity-70 sm:text-sm"
    return <details className="mt-4 border-t border-neutral-900" open={state.conflict || undefined}>
        <summary className="cursor-pointer py-3 text-sm text-neutral-400">Contact details and notes</summary>
        <DetailFields className="!mt-0">
            {([
                ["primaryPersonName", "Name", "identity", "text"], ["businessName", "Company", "relationship", "text"],
                ["primaryContactRole", "Contact role", "person", "text"], ["primaryEmail", "Email", "contact", "email"],
                ["primaryPhone", "Phone", "contact", "tel"], ["whatsappPhone", "WhatsApp", "contact", "tel"],
            ] as const).map(([key, label, icon, type]) => <DetailField key={key} label={label} icon={icon}><input aria-label={label} type={type} disabled={!canEdit} value={state.draft[key]} onChange={event => update(key, event.target.value)} onBlur={() => void queue.flush()} className={fieldClass} /></DetailField>)}
            <DetailField label="Preferred channel" icon="contact"><CommunicationMethodSelector choices={[{value:"meta_whatsapp"},{value:"twilio_sms"}]} value={state.draft.communicationPrimaryProvider} onChange={value => update("communicationPrimaryProvider", value as "meta_whatsapp" | "twilio_sms")} disabled={!canEdit} /></DetailField>
            <DetailField label="Delivery" icon="contact"><Selector ariaLabel="Message delivery" disabled={!canEdit} value={state.draft.communicationDeliveryMode} onChange={value => update("communicationDeliveryMode", value as RelationshipDraft["communicationDeliveryMode"])} options={[{value:"primary_only",label:"Preferred channel only"},{value:"primary_with_fallback",label:"Use fallback if needed"},{value:"mirror",label:"Both channels"}]} /></DetailField>
            <DetailField label="Notes" icon="description" className="lg:col-span-2"><textarea aria-label="Relationship notes" disabled={!canEdit} rows={3} value={state.draft.description} onChange={event => update("description", event.target.value)} onBlur={() => void queue.flush()} className={fieldClass} /></DetailField>
        </DetailFields>
        <p role="status" className="py-2 text-xs text-neutral-400">{state.error || state.storageError || (state.saving ? "Saving details…" : canEdit ? "Details save automatically" : "Read only")}</p>
        {state.error ? <button type="button" onClick={() => void queue.flush()} className="min-h-11 text-sm underline">Retry save</button> : null}
        {state.conflict ? <div role="alert" className="flex flex-wrap gap-3 py-2 text-sm text-amber-200"><span>Your draft is preserved. Review the latest values before saving.</span><button onClick={() => router.refresh()} className="min-h-11 underline">Refresh</button>{state.latest ? <><button onClick={() => queue.resolveConflict(false)} className="min-h-11 underline">Use saved values</button><button onClick={() => queue.resolveConflict(true)} className="min-h-11 underline">Keep my edits</button></> : null}</div> : null}
    </details>
}
