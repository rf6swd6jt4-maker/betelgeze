"use client"

import { useCallback, type ReactNode } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { AutoGrowTextarea } from "@/components/ui"
import { useWorkItemTextDraft } from "@/components/work-items/useWorkItemTextDraft"
import { saveNoteText } from "./actions"

const saved = () => {}
function noteField(label: string, draft: ReturnType<typeof useWorkItemTextDraft>, limit: number) {
    return <DetailField label={label} icon={label === "Name" ? "identity" : "description"} multiline>
        <div><AutoGrowTextarea ref={draft.ref} value={draft.value} onChange={event => draft.change(event.target.value)} onBlur={() => void draft.save()} required maxLength={limit} rows={1} aria-label={`Note ${label.toLowerCase()}`} className="block w-full bg-transparent text-sm leading-6 text-neutral-200 outline-none" />
            <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500"><span aria-live="polite" className={draft.error ? "text-red-300" : undefined}>{draft.error ?? (draft.state === "saving" ? "Saving…" : draft.state === "saved" ? "Saved" : "Changes save automatically")}</span>
                {draft.conflict ? <button type="button" onClick={draft.useLatest} className="text-red-200 underline">Use latest saved version</button> : draft.error ? <button type="button" onClick={() => void draft.save()} className="text-red-200 underline">Retry</button> : null}
            </div>
        </div>
    </DetailField>
}
export function NoteFieldsEditor({ slug, noteId, userId, updatedAt, name, description, createdAt, creator, links }: {
    slug: string; noteId: string; userId: string; updatedAt: string; name: string; description: string; createdAt: string; creator: ReactNode; links: ReactNode
}) {
    const saveName = useCallback((value: string, _version: string, baseline: string) => saveNoteText(slug, noteId, "name", value, baseline, userId), [slug, noteId, userId])
    const saveDescription = useCallback((value: string, _version: string, baseline: string) => saveNoteText(slug, noteId, "description", value, baseline, userId), [slug, noteId, userId])
    const common = { workspaceSlug: slug, workItemId: noteId, updatedAt, onSaved: saved }
    const nameDraft = useWorkItemTextDraft({ ...common, description: name, label: "Name", save: saveName })
    const descriptionDraft = useWorkItemTextDraft({ ...common, description, label: "Description", save: saveDescription })
    return <DetailFields columns={1}>
        {noteField("Name", nameDraft, 160)}
        <DetailField label="Created by" icon="user">{creator}</DetailField>
        <DetailField label="Created" icon="time">{new Date(createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</DetailField>
        {links}
        {noteField("Description", descriptionDraft, 20000)}
    </DetailFields>
}
