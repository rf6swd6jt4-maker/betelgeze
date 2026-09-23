"use client"
import { useCallback } from "react"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { useWorkItemTextDraft } from "@/components/work-items/useWorkItemTextDraft"
import { workItemTextField } from "@/components/work-items/WorkItemTextField"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { SopRecord } from "@/lib/sops/records-policy"
import { SopServiceLinks } from "./SopServiceLinks"
const saved = () => {}
export function SopDetailFields({ workspaceSlug, userId, sop, canEdit, admin }: { workspaceSlug: string; userId: string; sop: SopRecord; canEdit: boolean; admin: boolean }) {
    const save = useCallback(async (field: "title" | "description", value: string, baseline: string) => {
        const response = await fetch(`/api/workspaces/${workspaceSlug}/sops/${sop.id}`, { method: "PATCH", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value, baseline, userId }), signal: AbortSignal.timeout(30000) })
        const result = await response.json()
        return response.ok ? { ok: true as const, version: result.version as string } : { ok: false as const, error: result.error || "Could not save SOP.", conflict: response.status === 409 }
    }, [workspaceSlug, sop.id, userId])
    const saveName = useCallback((value: string, _version: string, baseline: string) => save("title", value, baseline), [save])
    const saveDescription = useCallback((value: string, _version: string, baseline: string) => save("description", value, baseline), [save])
    const common = { userId, recordType: "sop", workspaceSlug, workItemId: sop.id, updatedAt: sop.updated_at, onSaved: saved }
    const name = useWorkItemTextDraft({ ...common, field: "title", description: sop.title, label: "Name", save: saveName })
    const description = useWorkItemTextDraft({ ...common, field: "description", description: sop.description, label: "Description", save: saveDescription })
    return <>
        <DetailPageHeader category="SOP" reference={shortId(sop.id)} title={canEdit ? name.value || sop.title : sop.title} updated={formatRelativeTime(sop.updated_at)} />
        <DetailFields>
            {canEdit ? workItemTextField("Name", name) : null}
            {canEdit ? workItemTextField("Description", description) : <DetailField label="Description" icon="description" multiline stackOnMobile className="lg:col-span-2"><p className="whitespace-pre-wrap break-words">{sop.description || "No description yet."}</p></DetailField>}
            {admin ? <DetailField label="Services" icon="status" className="lg:col-span-2"><SopServiceLinks workspaceSlug={workspaceSlug} sopId={sop.id} userId={userId} canEdit={canEdit} /></DetailField> : null}
            {sop.archived_at ? <DetailField label="Availability" icon="status">Archived · read only</DetailField> : null}
        </DetailFields>
    </>
}
