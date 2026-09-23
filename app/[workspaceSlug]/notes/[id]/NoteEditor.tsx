"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react"
import { CenteredDialog, MultiSelector, type MultiSelectorOption } from "@/components/ui"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { updateNoteRelationships } from "./actions"

export function NoteEditor({ workspaceSlug, noteId, userId, relationships }: {
    workspaceSlug: string; noteId: string; userId: string; relationships: MultiSelectorOption[]
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [options, setOptions] = useState<MultiSelectorOption[]>([])
    const baseline = useRef(relationships.map(item => item.id))
    const [selected, setSelected] = useState(relationships.map(item => item.id))
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    useEffect(() => {
        if (!open || !loading) return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/shell-create-options`, { signal: controller.signal })
            .then(async response => {
                if (!response.ok) throw new Error("Could not load relationships.")
                const body = await response.json() as { relationshipOptions?: MultiSelectorOption[] }
                setOptions(body.relationshipOptions ?? [])
            }).catch(() => { if (!controller.signal.aborted) setError("Could not load relationships.") })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [loading, open, workspaceSlug])
    const choices = useMemo(() => [...new Map([...options, ...relationships].map(item => [item.id, item])).values()], [options, relationships])
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() => updateNoteRelationships(workspaceSlug, noteId, selected, baseline.current, userId), { category: "system" })
                if (!result.ok) { setError(result.error); return }
                setOpen(false); router.refresh()
            } catch { setError("The links could not be confirmed. Try again.") }
        })
    }
    return <>
        <button type="button" className="text-xs text-neutral-300 underline underline-offset-4" onClick={() => { baseline.current = relationships.map(item => item.id); setSelected(baseline.current); setLoading(!options.length); setError(null); setOpen(true) }}>Edit relationships</button>
        {open ? <CenteredDialog title="Linked relationships" busy={pending} onClose={() => setOpen(false)}><form onSubmit={submit} className="space-y-4">
            <MultiSelector label="Linked relationships" description="Choose up to 20 relationships for this note." placeholder={loading ? "Loading…" : "Choose relationships"} options={choices} selected={selected} onChange={setSelected} disabled={loading} maxSelections={20} />
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm">Cancel</button><button disabled={pending || loading} className="rounded-lg bg-white px-3 py-2 text-sm text-black disabled:opacity-50">Save links</button></div>
        </form></CenteredDialog> : null}
    </>
}
