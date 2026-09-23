import { DetailField } from "@/components/detail"
import type { useWorkItemTextDraft } from "./useWorkItemTextDraft"
import { WorkspaceDraftRecovery } from "@/components/workspace/WorkspaceDraftRecovery"

/** The same quiet text editor for the goal and the full procedure. Evidence has no editor. */
export function workItemTextField(label: "Name" | "Description" | "Instructions", draft: ReturnType<typeof useWorkItemTextDraft>) {
    const compact = label === "Name"
    return <DetailField label={label} icon="description" multiline stackOnMobile={!compact} className="lg:col-span-2">
        <div>
            <textarea ref={draft.ref} aria-label={label} value={draft.value} onChange={event => draft.change(event.target.value)} onBlur={() => void draft.save()}
                rows={label === "Name" ? 1 : label === "Description" ? 2 : 5} maxLength={label === "Name" ? 200 : undefined} placeholder={label === "Name" ? "SOP name" : label === "Description" ? "Add a description…" : "Add instructions and completion requirements…"}
                className={`${label === "Instructions" ? "min-h-20" : compact ? "min-h-6" : "min-h-12"} w-full resize-none overflow-hidden bg-transparent py-0 text-sm leading-6 text-neutral-200 caret-neutral-300 outline-none placeholder:text-neutral-600 selection:bg-neutral-600 selection:text-white`} />
            <div className="mt-1 flex items-center justify-end gap-2">
                <p aria-live="polite" title={draft.error ?? undefined} className={`text-xs ${draft.state === "error" ? "text-red-300" : "text-neutral-500"}`}>
                    {draft.recoveryPending ? "Review this draft before saving" : draft.state === "saving" ? `Saving ${label.toLowerCase()}…` : draft.state === "error" ? draft.error || "Could not save automatically" : draft.value !== draft.baseline ? `${label} will save automatically` : draft.state === "saved" ? `${label} saved` : `${label} saves automatically`}
                </p>
                {draft.recoveryPending ? <button type="button" onClick={() => void draft.saveRecovered()} className="text-xs text-amber-200 underline">Save reviewed draft</button> : draft.conflict ? <button type="button" onClick={draft.useLatest} className="shrink-0 text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Use latest version</button>
                    : draft.state === "error" ? <button type="button" onClick={() => void draft.save()} className="text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
            </div>
            <WorkspaceDraftRecovery journal={draft.journal} current={draft.value} label={label} onRestore={draft.restore} />
        </div>
    </DetailField>
}
