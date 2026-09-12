"use client"

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import type { WorkspaceCreateActionState } from "@/app/[workspaceSlug]/relationships/actions"
import { usePathname } from "@/components/workspace/WorkspaceNavigation"
import { AssignmentSelector } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

export type WorkspaceCreateTarget = "relationship" | "work-item" | "asset" | "okr"

type CreateOptions = {
    workItemOptions: Array<{ id: string; title: string; status: string }>
    relationshipOptions: Array<{ id: string; label: string }>
    okrOwnerOptions: Array<{ id: string; label: string; role: string; avatarSrc?: string | null }>
}

type Props = {
    target: WorkspaceCreateTarget
    workspace: { id: string; name: string; slug: string }
    currentUserId: string
    username: string
    currentUserRole: string
    createRelationshipAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createWorkItemAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createAssetAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createOkrAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    onClose: () => void
    onCreated: (result: WorkspaceCreateActionState, target: WorkspaceCreateTarget) => void
}

const EMPTY_OPTIONS: CreateOptions = { workItemOptions: [], relationshipOptions: [], okrOwnerOptions: [] }

function defaultOkrPeriod() {
    const start = new Date()
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 90)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export function WorkspaceCreateModal({ target, workspace, currentUserId, username, currentUserRole, createRelationshipAction, createWorkItemAction, createAssetAction, createOkrAction, onClose, onCreated }: Props) {
    const dialogRef = useRef<HTMLDialogElement | null>(null)
    // Other create modes retain their established host for portalled selectors.
    const ModalTag = target === "relationship" ? "dialog" : "div"
    useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close() }, [target])
    const pathname = usePathname()
    const linkedRelationshipId = pathname.match(/\/relationships\/([a-f0-9-]{36})(?:\/|$)/i)?.[1] ?? ""
    const relationshipRequestId = useRef<string | null>(null)
    const [okrOwnerId, setOkrOwnerId] = useState(currentUserId)
    const [options, setOptions] = useState<CreateOptions>(EMPTY_OPTIONS)
    const [optionsLoading, setOptionsLoading] = useState(target !== "relationship")
    const [optionsError, setOptionsError] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)
    const [uploadLabel, setUploadLabel] = useState<string | null>(null)
    const [isCreating, startCreateTransition] = useTransition()
    const [okrPeriod] = useState(defaultOkrPeriod)

    useEffect(() => {
        if (target === "relationship") return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspace.slug)}/shell-create-options`, { signal: controller.signal })
            .then(async (response) => {
                const result = await response.json().catch(() => null) as Partial<CreateOptions> & { error?: string } | null
                if (!response.ok || !result) throw new Error(result?.error ?? "Could not load linked record choices.")
                setOptions({
                    workItemOptions: result.workItemOptions ?? [],
                    relationshipOptions: result.relationshipOptions ?? [],
                    okrOwnerOptions: result.okrOwnerOptions ?? [],
                })
            })
            .catch((error) => { if (!controller.signal.aborted) setOptionsError(error instanceof Error ? error.message : "Could not load linked record choices.") })
            .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false) })
        return () => controller.abort()
    }, [target, workspace.slug])

    async function submitCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setCreateError(null)
        const form = event.currentTarget
        const formData = new FormData(form)
        if (target === "relationship") {
            relationshipRequestId.current ??= crypto.randomUUID()
            formData.set("relationship_request_id", relationshipRequestId.current)
        }

        if (target === "asset") {
            const file = formData.get("asset_file")
            if (!(file instanceof File) || file.size === 0) {
                setCreateError("Choose a file to upload.")
                return
            }
            setUploadLabel(`Uploading ${file.name}`)
            try {
                const prepare = await fetch(`/api/workspaces/${workspace.slug}/assets/upload`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }),
                })
                const prepared = await prepare.json() as { uploadUrl?: string; storedAsset?: { name: string; path: string; size: number; type: string; kind: string }; error?: string }
                if (!prepare.ok || !prepared.uploadUrl || !prepared.storedAsset) throw new Error(prepared.error ?? "Could not prepare upload.")
                const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "content-type": prepared.storedAsset.type }, body: file })
                if (!upload.ok) throw new Error("The file could not be uploaded.")
                formData.set("storage_path", prepared.storedAsset.path)
                formData.set("content_type", prepared.storedAsset.type)
                formData.set("file_size", String(prepared.storedAsset.size))
                formData.set("asset_kind", prepared.storedAsset.kind)
                formData.set("original_name", prepared.storedAsset.name)
                if (!String(formData.get("title") ?? "").trim()) formData.set("title", prepared.storedAsset.name)
            } catch (error) {
                setCreateError(error instanceof TypeError ? "The browser could not reach file storage. Please try again in a moment." : error instanceof Error ? error.message : "Upload failed.")
                setUploadLabel(null)
                return
            }
            setUploadLabel(null)
        }

        startCreateTransition(async () => {
            try {
            const result = await runWorkspaceMutation(() => target === "relationship"
                ? createRelationshipAction(formData)
                : target === "work-item"
                    ? createWorkItemAction(formData)
                    : target === "asset"
                        ? createAssetAction(formData)
                        : createOkrAction(formData), { category: target === "okr" ? "maintenance" : target === "asset" ? "system" : target === "work-item" ? "gantt" : "services" })
            if (!result.ok) {
                setCreateError(result.error ?? "Could not create this item.")
                return
            }
            form.reset()
            onCreated(result, target)
            } catch { setCreateError("The save could not be confirmed. Retry to recover this same relationship.") }
        })
    }

    const title = target === "relationship" ? "Add relationship" : target === "work-item" ? "Add work item" : target === "asset" ? "Add asset" : "Create OKR"
    const submitLabel = target === "relationship"
        ? "Create relationship"
        : target === "work-item" ? "Create work item"
            : target === "asset" ? "Create asset"
                : "Create OKR"
    const ownerOptions = options.okrOwnerOptions.length ? options.okrOwnerOptions : [{ id: currentUserId, label: username, role: currentUserRole }]

    return <ModalTag ref={(node: HTMLElement | null) => { dialogRef.current = node instanceof HTMLDialogElement ? node : null }} role="dialog" aria-modal="true" className={`fixed inset-0 z-[90] m-0 h-dvh max-h-none w-full max-w-none items-center justify-center border-0 bg-black/70 px-4 py-6 backdrop-blur-sm ${target === "relationship" ? "open:flex" : "flex"}`} aria-labelledby="workspace-create-title" onCancel={event => { event.preventDefault(); if (!isCreating) onClose() }} onMouseDown={event => { if (!isCreating && event.target === event.currentTarget) onClose() }}>
        <div className="betelgeze-popup-enter w-full max-w-xl overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-white shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 sm:px-5">
                <div><p className="text-xs text-neutral-500">Create in {workspace.name}</p><h2 id="workspace-create-title" className="text-lg font-semibold">{title}</h2></div>
                <button data-icon-button type="button" onClick={onClose} disabled={isCreating} aria-label="Close create panel" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-900 hover:text-white"><span aria-hidden="true" className="text-xl leading-none">×</span></button>
            </div>
            <form onSubmit={submitCreate} className="max-h-[min(70vh,42rem)] overflow-y-auto px-4 py-4 sm:px-5">
                {target === "relationship" ? <div className="space-y-4">
                    <p className="text-sm leading-6 text-neutral-400">Start with the person. Add their services from the relationship page.</p>
                    <label className="block text-sm text-neutral-300">Name<input name="primary_person_name" maxLength={200} required autoFocus autoComplete="name" placeholder="Person or primary contact" className="mt-1.5 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-base text-white" /></label>
                    <label className="block text-sm text-neutral-300">Company <span className="text-neutral-500">· optional</span><input name="business_name" maxLength={200} autoComplete="organization" className="mt-1.5 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-base text-white" /></label>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm text-neutral-300">Email <span className="text-neutral-500">· optional</span><input name="primary_email" type="email" maxLength={320} autoComplete="email" className="mt-1.5 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-base text-white" /></label>
                        <label className="block text-sm text-neutral-300">Phone <span className="text-neutral-500">· optional</span><input name="primary_phone" type="tel" maxLength={80} autoComplete="tel" className="mt-1.5 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-base text-white" /></label>
                    </div>
                    <details className="text-sm text-neutral-400"><summary className="cursor-pointer py-2">More options</summary><label className="flex min-h-11 items-center gap-2"><input name="is_test" type="checkbox" />Test relationship</label></details>
                </div> : null}

                {target === "work-item" ? <div className="space-y-5">
                    <section className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300 sm:col-span-2">Title<input name="title" required autoFocus placeholder="What needs to happen?" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white placeholder:text-neutral-600" /></label><label className="block text-sm text-neutral-300">Stage<select name="lifecycle_phase" defaultValue="fulfilment" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"><option value="lead">Lead</option><option value="onboarding">Onboarding</option><option value="fulfilment">Fulfilment</option><option value="retention">Retention</option></select></label><label className="block text-sm text-neutral-300">Status<select name="status" defaultValue="todo" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"><option value="todo">To do</option><option value="doing">In progress</option><option value="waiting">Waiting</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label></section>
                    <section className="grid gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-2"><div><p className="text-sm text-neutral-300">Start</p><div className="mt-1.5 grid grid-cols-[1fr_5.5rem] gap-2"><input name="planned_start_date" type="date" aria-label="Start date" className="h-10 min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-white" /><input name="planned_start_time" type="time" aria-label="Start time" className="h-10 min-w-0 rounded-lg border border-neutral-700 bg-black px-2 text-white" /></div></div><div><p className="text-sm text-neutral-300">Due</p><div className="mt-1.5 grid grid-cols-[1fr_5.5rem] gap-2"><input name="due_date" type="date" aria-label="Due date" className="h-10 min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-white" /><input name="due_time" type="time" aria-label="Due time" className="h-10 min-w-0 rounded-lg border border-neutral-700 bg-black px-2 text-white" /></div></div></section>
                    <section className="grid gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Linked relationship<select name="relationship_id" defaultValue={linkedRelationshipId} disabled={optionsLoading} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white disabled:opacity-60"><option value="">{optionsLoading ? "Loading…" : "None"}</option>{options.relationshipOptions.map((relationship) => <option key={relationship.id} value={relationship.id}>{relationship.label}</option>)}</select></label><label className="block text-sm text-neutral-300">Parent work item<select name="parent_work_item_id" defaultValue="" disabled={optionsLoading} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white disabled:opacity-60"><option value="">{optionsLoading ? "Loading…" : "None"}</option>{options.workItemOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="flex items-center gap-2 text-sm text-neutral-400 sm:col-span-2"><input name="wait_for_parent" type="checkbox" value="off" className="h-4 w-4 rounded border-neutral-700 bg-black" /> Can start before its parent is complete</label></section>
                    <section className="grid gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-[1fr_auto]"><label className="block text-sm text-neutral-300">Description<textarea name="description" rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label><div className="flex items-end"><label className="flex h-10 items-center gap-2 whitespace-nowrap text-sm text-neutral-300"><input name="is_key_task" type="checkbox" defaultChecked className="h-4 w-4 rounded border-neutral-700 bg-black" /> Key task</label><input name="priority" type="hidden" value="3" /></div></section>
                </div> : null}

                {target === "asset" ? <div className="space-y-5"><section className="space-y-3"><label className="block text-sm text-neutral-300">File<input name="asset_file" type="file" required autoFocus className="mt-1.5 block w-full rounded-lg border border-dashed border-neutral-700 bg-black px-3 py-3 text-sm text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-black" /></label><label className="block text-sm text-neutral-300">Title<input name="title" placeholder="Defaults to the file name" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white placeholder:text-neutral-600" /></label></section><section className="grid gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Link to relationship<select name="relationship_id" defaultValue={linkedRelationshipId} disabled={optionsLoading} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white disabled:opacity-60"><option value="">{optionsLoading ? "Loading…" : "None"}</option>{options.relationshipOptions.map((relationship) => <option key={relationship.id} value={relationship.id}>{relationship.label}</option>)}</select></label><label className="block text-sm text-neutral-300">Link to work item<select name="work_item_id" defaultValue="" disabled={optionsLoading} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white disabled:opacity-60"><option value="">{optionsLoading ? "Loading…" : "None"}</option>{options.workItemOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></section><label className="block border-t border-neutral-900 pt-4 text-sm text-neutral-300">Description<textarea name="description" rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label></div> : null}

                {target === "okr" ? <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300 sm:col-span-2">Objective<input name="objective" required autoFocus placeholder="Increase reliable monthly sales" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white placeholder:text-neutral-600" /></label><label className="block text-sm text-neutral-300 sm:col-span-2">Description<textarea name="description" rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label></section><section className="grid gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Starts<input name="period_start" type="date" defaultValue={okrPeriod.start} required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><label className="block text-sm text-neutral-300">Deadline<input name="period_end" type="date" defaultValue={okrPeriod.end} required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><div className="text-sm text-neutral-300"><p>Owner</p><span className="mt-1.5 block"><AssignmentSelector name="owner_user_id" value={okrOwnerId} onChange={setOkrOwnerId} people={ownerOptions.map((owner) => ({ id: owner.id, name: owner.label, avatarSrc: owner.avatarSrc, description: owner.role }))} required appearance="input" ariaLabel="Objective owner" title="Assign Objective owner" /></span></div></section><p className="text-xs leading-5 text-neutral-500">This will be saved as a fully editable draft. Add and review its Key Results from the OKRs table before committing it.</p></div> : null}

                {optionsError ? <p className="mt-4 text-xs text-amber-300">{optionsError} You can still create this item without an optional link.</p> : null}
                {createError ? <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{createError}</p> : null}
                {uploadLabel ? <p className="mt-4 text-sm text-neutral-400">{uploadLabel}</p> : null}
                <div className="mt-5 flex justify-end gap-3"><button disabled={isCreating || Boolean(uploadLabel)} className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-60">{isCreating || uploadLabel ? "Creating…" : submitLabel}</button></div>
            </form>
        </div>
    </ModalTag>
}
