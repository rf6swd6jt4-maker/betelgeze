import { DetailField } from "@/components/detail"
import type { useWorkItemTextDraft } from "./useWorkItemTextDraft"

/** The same quiet text editor for the goal and the full procedure. Evidence has no editor. */
export function workItemTextField(label: "Description" | "Instructions", draft: ReturnType<typeof useWorkItemTextDraft>) {
    return <DetailField label={label} icon="description" multiline stackOnMobile className="lg:col-span-2">
        <div>
            <textarea ref={draft.ref} aria-label={label} value={draft.value} onChange={event => draft.change(event.target.value)} onBlur={() => void draft.save()}
                rows={label === "Description" ? 2 : 5} placeholder={label === "Description" ? "Add a description…" : "Add instructions and completion requirements…"}
                className={`${label === "Description" ? "min-h-12" : "min-h-20"} w-full resize-none overflow-hidden bg-transparent py-0 text-sm leading-6 text-neutral-200 caret-neutral-300 outline-none placeholder:text-neutral-600 selection:bg-neutral-600 selection:text-white`} />
            <div className="mt-1 flex items-center justify-end gap-2">
                <p aria-live="polite" title={draft.error ?? undefined} className={`text-xs ${draft.state === "error" ? "text-red-300" : "text-neutral-500"}`}>
                    {draft.state === "saving" ? `Saving ${label.toLowerCase()}…` : draft.state === "error" ? draft.error || "Could not save automatically" : draft.value !== draft.baseline ? `${label} will save automatically` : draft.state === "saved" ? `${label} saved` : `${label} saves automatically`}
                </p>
                {draft.conflict ? <button type="button" onClick={draft.useLatest} className="shrink-0 text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Use latest version</button>
                    : draft.state === "error" ? <button type="button" onClick={() => void draft.save()} className="text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
            </div>
        </div>
    </DetailField>
}
