"use client"

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react"
import { AutoGrowTextarea, CenteredDialog, MultiSelector, type MultiSelectorOption } from "@/components/ui"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { updateNote } from "./actions"

type Options = {
    relationshipOptions: Array<{ id: string; label: string }>
    assetOptions: Array<{ id: string; title: string; assetKind: string }>
}

const button = "inline-flex min-h-9 items-center justify-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:opacity-45"
const field = "mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white placeholder:text-neutral-600"

export function NoteEditor({ workspaceSlug, noteId, name, description, relationships, assets }: {
    workspaceSlug: string
    noteId: string
    name: string
    description: string
    relationships: MultiSelectorOption[]
    assets: MultiSelectorOption[]
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [options, setOptions] = useState<Options>({ relationshipOptions: [], assetOptions: [] })
    const [relationshipIds, setRelationshipIds] = useState(relationships.map((item) => item.id))
    const [assetIds, setAssetIds] = useState(assets.map((item) => item.id))
    const [loading, setLoading] = useState(false)
    const [optionsLoaded, setOptionsLoaded] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        if (!open || !loading || optionsLoaded) return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/shell-create-options?include=assets`, { signal: controller.signal })
            .then(async (response) => {
                const body = await response.json().catch(() => null) as Options & { error?: string } | null
                if (!response.ok || !body) throw new Error(body?.error ?? "Could not load linked record choices.")
                setOptions({ relationshipOptions: body.relationshipOptions ?? [], assetOptions: body.assetOptions ?? [] })
                setOptionsLoaded(true)
            })
            .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load linked record choices.") })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [loading, open, optionsLoaded, workspaceSlug])

    const relationshipOptions = useMemo(() => mergeOptions(relationships, options.relationshipOptions.map((item) => ({ id: item.id, label: item.label }))), [options.relationshipOptions, relationships])
    const assetOptions = useMemo(() => mergeOptions(assets, options.assetOptions.map((item) => ({ id: item.id, label: item.title, description: item.assetKind.replace(/_/g, " ") }))), [assets, options.assetOptions])

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        const formData = new FormData(event.currentTarget)
        for (const id of relationshipIds) formData.append("relationship_ids", id)
        for (const id of assetIds) formData.append("asset_ids", id)
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() => updateNote(workspaceSlug, noteId, formData), { category: "system" })
                if (!result.ok) { setError(result.error); return }
                setOpen(false)
                router.refresh()
            } catch {
                setError("The save could not be confirmed. Please retry.")
            }
        })
    }

    return <>
        <div className="mt-3 flex justify-end"><button type="button" className={button} onClick={() => { setError(null); setRelationshipIds(relationships.map((item) => item.id)); setAssetIds(assets.map((item) => item.id)); setLoading(!optionsLoaded); setOpen(true) }}>Edit note</button></div>
        {open ? <CenteredDialog title="Edit note" wide busy={pending} onClose={() => setOpen(false)}>
            <form onSubmit={submit} className="space-y-5">
                <label className="block text-sm text-neutral-300">Name<input name="name" defaultValue={name} required maxLength={160} autoFocus className={`${field} h-10`} /></label>
                <label className="block text-sm text-neutral-300">Description<AutoGrowTextarea name="description" defaultValue={description} required maxLength={20000} rows={7} className={field} /></label>
                <section className="grid gap-4 border-t border-neutral-900 pt-4 sm:grid-cols-2">
                    <div className="text-sm text-neutral-300"><p className="mb-1.5">Relationships</p><MultiSelector label="Linked relationships" description="Choose up to 20 relationships that belong with this note." placeholder={loading ? "Loading…" : "Choose relationships"} options={relationshipOptions} selected={relationshipIds} onChange={setRelationshipIds} disabled={loading} maxSelections={20} /></div>
                    <div className="text-sm text-neutral-300"><p className="mb-1.5">Assets</p><MultiSelector label="Linked assets" description="Choose up to 20 assets that belong with this note." placeholder={loading ? "Loading…" : "Choose assets"} options={assetOptions} selected={assetIds} onChange={setAssetIds} disabled={loading} maxSelections={20} /></div>
                </section>
                {error ? <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
                <div className="flex justify-end gap-3"><button type="button" className={button} disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button className="inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-60" disabled={pending || loading}>{pending ? "Saving…" : "Save note"}</button></div>
            </form>
        </CenteredDialog> : null}
    </>
}

function mergeOptions(primary: MultiSelectorOption[], available: MultiSelectorOption[]) {
    const merged = new Map(available.map((option) => [option.id, option]))
    for (const option of primary) merged.set(option.id, option)
    return [...merged.values()]
}
