"use client"

import type { ReactNode } from "react"
import { DetailField, DetailFields, type DetailFieldIcon } from "@/components/detail"
import { Assignee } from "@/components/ui"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

/**
 * Today layout only: who manages the client and where they came from, in the Details column of their Overview beside
 * the editable details. It renders the context the page already loads. How to reach the client is the Contact group
 * (RelationshipContactCards rows); there are no buttons here.
 */
export function ClientSummary({ context }: { context: WorkspaceTabRelationshipContext }) {
    const fields: Array<{ label: string; icon: DetailFieldIcon; value: ReactNode }> = []
    if (!context.teamUnavailable) fields.push({ label: "Manager", icon: "user", value: context.manager ? <Assignee name={context.manager.name} avatarSrc={context.manager.avatarSrc} /> : <span className="text-neutral-500">Unassigned</span> })
    if (context.source_label?.trim()) fields.push({ label: "Source", icon: "source", value: context.source_label.trim() })
    if (!fields.length) return null
    return <div data-client-summary>
        <DetailFields columns={1} className="mt-0! [&>div]:grid-cols-[5.5rem_minmax(0,1fr)] sm:[&>div]:grid-cols-[5.5rem_minmax(0,1fr)]">
            {fields.map(field => <DetailField key={field.label} label={field.label} icon={field.icon}>{field.value}</DetailField>)}
        </DetailFields>
    </div>
}
