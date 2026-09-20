"use client"

import { DetailField, DetailFields } from "@/components/detail"
import { AutoGrowTextarea } from "@/components/ui"
import { WorkspaceAutosaveForm } from "@/components/workspace/WorkspaceAutosaveForm"
import { saveNoteFields } from "./actions"
import type { ReactNode } from "react"

export function NoteFieldsEditor({ slug, noteId, name, description, createdAt, creator, links }: {
    slug: string
    noteId: string
    name: string
    description: string
    createdAt: string
    creator: ReactNode
    links: ReactNode
}) {
    return <WorkspaceAutosaveForm action={saveNoteFields.bind(null, slug, noteId)} statusClassName="mt-2 justify-end text-xs text-neutral-500">
        <DetailFields columns={1}>
            <DetailField label="Name" icon="identity"><input name="name" defaultValue={name} required maxLength={160} className="w-full bg-transparent text-sm text-neutral-200 outline-none" aria-label="Note name" /></DetailField>
            <DetailField label="Created by" icon="user">{creator}</DetailField>
            <DetailField label="Created" icon="time">{new Date(createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</DetailField>
            {links}
            <DetailField label="Description" icon="description"><AutoGrowTextarea name="description" defaultValue={description} required maxLength={20000} rows={1} className="block w-full bg-transparent text-sm leading-6 text-neutral-200 outline-none" aria-label="Note description" /></DetailField>
        </DetailFields>
    </WorkspaceAutosaveForm>
}
