"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { CenteredDialog, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import type { WorkspaceDraftJournal, WorkspaceRecoveredDraft } from "@/lib/workspace-draft-journal"

/** Recovery is explicit; viewing another writer's copy never submits it. */
type RecoveryProps = { journal: WorkspaceDraftJournal; current: string | (() => string); label: string; onRestore: (draft: WorkspaceRecoveredDraft) => void }
export function WorkspaceDraftRecovery(props: RecoveryProps) {
    return <RecoveryDialog key={props.journal.scopeKey} {...props} />
}
function RecoveryDialog({ journal, current, label, onRestore }: RecoveryProps) {
    const [open, setOpen] = useState(false)
    const [drafts, setDrafts] = useState<WorkspaceRecoveredDraft[]>([])
    const [selected, setSelected] = useState<WorkspaceRecoveredDraft | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [limit, setLimit] = useState(10)
    const [currentText, setCurrentText] = useState("")
    const available = useSyncExternalStore(journal.subscribe, journal.hasRecovery, () => false)
    const abort = useRef<AbortController | null>(null)
    useEffect(() => () => abort.current?.abort(), [])
    useEffect(() => {
        const clear = (event: Event) => {
            if ((event as CustomEvent<{ preservedUserId?: string }>).detail?.preservedUserId === journal.userId) return
            abort.current?.abort(); setOpen(false); setSelected(null); setDrafts([])
        }
        window.addEventListener("betelgeze:offline-account-clearing", clear)
        return () => window.removeEventListener("betelgeze:offline-account-clearing", clear)
    }, [journal])
    useEffect(() => { journal.inspectRecovery() }, [journal])
    if (!available) return null
    const close = () => { abort.current?.abort(); setOpen(false); setSelected(null) }
    const review = () => {
        if (!journal.active()) return
        abort.current?.abort()
        const controller = new AbortController()
        abort.current = controller
        setOpen(true); setLoading(true); setError(null); setLimit(10)
        try { setCurrentText(typeof current === "function" ? current() : current) } catch { setCurrentText("Current form values are unavailable.") }
        void journal.review(controller.signal).then((result) => {
            if (controller.signal.aborted || !journal.active()) return
            setDrafts(result.drafts); setError(result.error); setLoading(false)
        }).catch(() => { if (!controller.signal.aborted) { setError("Saved drafts could not be read."); setLoading(false) } })
    }
    return <>
        <button type="button" onClick={review} className="text-xs text-amber-200 underline underline-offset-2">Review saved drafts</button>
        {open ? <CenteredDialog title={`${label} draft recovery`} onClose={close} wide>
            <p className="text-sm text-neutral-400">Review the current text and saved copy before using it. Other saved copies stay available.</p>
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            {loading ? <Status label="Reading saved drafts" tone="yellow" /> : selected ? <>
                <label className="mt-4 block text-sm">Current text<textarea readOnly value={currentText} rows={5} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm" /></label>
                <label className="mt-4 block text-sm">Saved draft<textarea readOnly value={selected.value} rows={5} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black p-3 text-sm" /></label>
                <p className="mt-2 text-xs text-neutral-400">Using this copy returns it to the editor for review. It does not save it to the server.</p>
                <div className="mt-4 flex justify-end gap-4"><button type="button" onClick={() => setSelected(null)} className="text-sm text-neutral-300">Back</button><button type="button" onClick={() => { if (journal.active()) onRestore(selected); close() }} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Use this draft</button></div>
            </> : <>
                <List ariaLabel="Saved drafts">
                    {drafts.slice(0, limit).map((draft) => <ListItem key={draft.id}>
                        <ListPrimaryRow><ListTitle>{new Date(draft.savedAt).toLocaleString()}</ListTitle><Status label={draft.durable ? "Saved on this device" : "Open page only"} tone={draft.durable ? "grey" : "yellow"} /></ListPrimaryRow>
                        <ListSecondaryRow><span className="text-xs text-neutral-500">{draft.value.length.toLocaleString()} characters</span><ListTrailing><button type="button" onClick={() => setSelected(draft)} className="text-sm text-white underline">Review</button></ListTrailing></ListSecondaryRow>
                    </ListItem>)}
                </List>
                {!drafts.length ? <p className="mt-3 text-sm text-neutral-400">No saved drafts remain for this field.</p> : null}
                {drafts.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 10)} className="mt-3 text-sm text-white underline">Show more drafts</button> : null}
            </>}
        </CenteredDialog> : null}
    </>
}
