"use client"

import { DetailField, DetailFields } from "@/components/detail"
import { AutoGrowTextarea } from "@/components/ui"
import { WorkspaceAutosaveForm } from "@/components/workspace/WorkspaceAutosaveForm"
import { saveNoteFields } from "./actions"
import type { ReactNode } from "react"

export function NoteFieldsEditor({ slug, noteId, name, description, createdAt, reference, links }: {
    slug: string
    noteId: string
    name: string
    description: string
    createdAt: string
    reference: string
    links: ReactNode
}) {
    return <WorkspaceAutosaveForm action={saveNoteFields.bind(null, slug, noteId)} statusClassName="mt-2 justify-end text-xs text-neutral-500">
        <DetailFields>
            {links}
            <DetailField label="Name" icon="identity" className="lg:col-span-2"><input name="name" defaultValue={name} required maxLength={160} className="w-full bg-transparent text-sm text-neutral-200 outline-none" aria-label="Note name" /></DetailField>
            <DetailField label="Description" icon="description" className="lg:col-span-2"><AutoGrowTextarea name="description" defaultValue={description} required maxLength={20000} rows={5} className="min-h-28 w-full bg-transparent text-sm leading-6 text-neutral-200 outline-none" aria-label="Note description" /></DetailField>
            <DetailField label="Created" icon="time">{new Date(createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</DetailField>
            <DetailField label="Reference" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="font-mono">{reference}</span></DetailField>
        </DetailFields>
    </WorkspaceAutosaveForm>
}
