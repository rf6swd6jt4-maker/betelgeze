"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListPrimaryAction } from "@/components/list/ListPrimaryAction"
import { PortalIcon, PortalSection, portalPrimaryButton } from "@/components/client-portal/ClientPortalUI"
import { Status } from "@/components/ui"
import { resourceSizeLabel, type PortalResource } from "@/lib/client-portal/resources"
import { droppedResources, fileSelection, selectedFolders, type ResourceSelection } from "@/lib/client-portal/resource-selection"
import { ResourceTransfer, type TransferProgress } from "@/lib/client-portal/resource-transfer"

type UploadTask = { id: string; name: string; total: number; loaded: number; state: TransferProgress["state"] | "queued" | "failed" }
type QueuedTransfer = { task: UploadTask; transfer: ResourceTransfer; controller: AbortController }

export function ClientPortalResources({ token }: { token: string }) {
    const api = `/api/client-portal/session/${encodeURIComponent(token)}/resources`
    const [resources, setResources] = useState<PortalResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [tasks, setTasks] = useState<UploadTask[]>([])
    const [reading, setReading] = useState(false)
    const [folderSupported, setFolderSupported] = useState(true)
    const [notice, setNotice] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const fileInput = useRef<HTMLInputElement>(null)
    const folderInput = useRef<HTMLInputElement>(null)
    const queue = useRef<QueuedTransfer[]>([])
    const running = useRef(false)
    const alive = useRef(true)
    const savedResources = useRef(new Map<string, PortalResource>())

    const load = useCallback(async (offset = 0) => {
        try {
            const response = await fetch(`${api}?offset=${offset}`, { cache: "no-store" })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || "Could not load resources.")
            setResources((current) => {
                const base = offset ? current : [...savedResources.current.values()]
                return [...base, ...result.resources.filter((item: PortalResource) => !base.some((old) => old.id === item.id))]
            })
            setHasMore(result.hasMore)
            setError(null)
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load resources.") }
        finally { setLoading(false) }
    }, [api])

    useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
    useEffect(() => {
        alive.current = true
        queueMicrotask(() => { if (alive.current) setFolderSupported("webkitdirectory" in document.createElement("input")) })
        const transfers = queue.current
        return () => { alive.current = false; for (const item of transfers) { item.controller.abort(); void item.transfer.cancel() } }
    }, [])
    useEffect(() => {
        if (!tasks.length && !reading) return
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [tasks.length, reading])

    function update(item: QueuedTransfer, changes: Partial<UploadTask>) {
        Object.assign(item.task, changes)
        if (alive.current) setTasks((current) => current.map((task) => task.id === item.task.id ? { ...item.task } : task))
    }

    async function drain() {
        if (running.current) return
        running.current = true
        let saved = 0
        try {
            while (alive.current) {
                const item = queue.current.find((candidate) => candidate.task.state === "queued" && !candidate.controller.signal.aborted)
                if (!item) break
                update(item, { state: "uploading" })
                try {
                    const resource = await item.transfer.run(item.controller.signal, (progress) => update(item, progress))
                    if (!alive.current || item.controller.signal.aborted) continue
                    savedResources.current.set(resource.id, resource)
                    setResources((current) => [resource, ...current.filter((old) => old.id !== resource.id)])
                    setTasks((current) => current.filter((task) => task.id !== item.task.id))
                    queue.current.splice(queue.current.indexOf(item), 1)
                    saved++
                } catch {
                    if (!item.controller.signal.aborted) update(item, { state: "failed" })
                }
            }
        } finally {
            running.current = false
            if (alive.current && saved) setNotice(`${saved === 1 ? "Your file is" : `${saved} files are`} saved and available to your team.`)
        }
    }

    function enqueue(selections: ResourceSelection[]) {
        if (!selections.length) return
        setNotice(null)
        const added = selections.map((selection) => {
            const id = crypto.randomUUID()
            return { task: { id, name: selection.name, total: selection.size, loaded: 0, state: "queued" as const }, transfer: new ResourceTransfer(api, id, selection), controller: new AbortController() }
        })
        queue.current.push(...added)
        setTasks((current) => [...current, ...added.map((item) => item.task)])
        void drain()
    }

    function retry(id: string) {
        const item = queue.current.find((candidate) => candidate.task.id === id)
        if (!item) return
        update(item, { state: "queued" })
        void drain()
    }

    function remove(id: string) {
        const item = queue.current.find((candidate) => candidate.task.id === id)
        if (!item) return
        item.controller.abort()
        void item.transfer.cancel()
        queue.current.splice(queue.current.indexOf(item), 1)
        setTasks((current) => current.filter((task) => task.id !== id))
    }

    async function drop(transfer: DataTransfer) {
        setReading(true)
        try {
            const { selections, failures } = await droppedResources(transfer)
            enqueue(selections)
            if (failures.length) setNotice(`We couldn’t read ${failures.join(", ")}. The other files will still upload.`)
        } finally { setReading(false) }
    }

    return <PortalSection id="resources" title="Your files" description="Send any files or folders to your team." icon="files">
        <input ref={fileInput} type="file" multiple className="hidden" aria-label="Choose files to upload" onChange={(event) => { enqueue(Array.from(event.target.files ?? []).map(fileSelection)); event.target.value = "" }} />
        <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", "") }} type="file" multiple className="hidden" aria-label="Choose a folder to upload" onChange={(event) => { enqueue(selectedFolders(Array.from(event.target.files ?? []))); event.target.value = "" }} />
        <div onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); void drop(event.dataTransfer) }} className={`mt-6 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_10%,transparent)]" : "border-black/15 bg-black/[0.015]"}`}>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={() => fileInput.current?.click()} className={portalPrimaryButton}><PortalIcon name="upload" />Upload files</button>
                {folderSupported ? <button type="button" onClick={() => folderInput.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/15 bg-[var(--onboarding-surface,#FFFFFF)] px-4 py-2.5 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-4"><PortalIcon name="folder" />Upload a folder</button> : null}
            </div>
            <p className="mt-3 text-sm text-[var(--onboarding-muted,#475569)]"><span className="hidden sm:inline">Or drag files and folders here</span><span className="sm:hidden">Choose anything you want to share</span></p><p className="mt-1 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Any file type. Folders are packaged automatically.</p>
        </div>
        {notice ? <p role="status" className="mt-4 rounded-lg bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_5%,transparent)] px-3 py-2.5 text-sm leading-6">{notice}</p> : null}
        {reading ? <p role="status" className="mt-3 text-sm">Reading your folder…</p> : null}
        {tasks.length ? <><p role="status" className="mt-3 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Keep this page open while your files are sent. You can add more at any time.</p><List surface="light" ariaLabel="Uploads in progress">{tasks.map((task) => <ListItem key={task.id}>
            <ListPrimaryRow><ListTitle className="flex-1">{task.name}</ListTitle><Status surface="light" tone={task.state === "failed" ? "red" : task.state === "queued" ? "grey" : "yellow"} label={task.state === "failed" ? "Not sent" : task.state === "saving" ? "Saving" : task.state === "queued" ? "Queued" : task.state === "waiting" ? "Reconnecting" : `${Math.min(99, Math.round(task.loaded / Math.max(1, task.total) * 100))}%`} /></ListPrimaryRow>
            <ListSecondaryRow><span className="min-w-0 truncate text-xs text-[var(--onboarding-muted,#475569)]">{task.state === "failed" ? "Try again to finish sending" : `${resourceSizeLabel(task.loaded)} sent`}</span><ListTrailing>{task.state === "failed" ? <button type="button" onClick={() => retry(task.id)} className="min-h-11 px-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]" aria-label={`Retry ${task.name}`}>Retry</button> : null}<button type="button" onClick={() => remove(task.id)} className="min-h-11 px-2 text-sm text-[var(--onboarding-muted,#475569)]" aria-label={`Cancel ${task.name}`}>{task.state === "failed" ? "Remove" : "Cancel"}</button></ListTrailing></ListSecondaryRow>
        </ListItem>)}</List></> : null}
        {error ? <div role="alert" className="mt-4 text-sm text-red-700">{error} <button type="button" onClick={() => { setLoading(true); void load() }} className="underline">Try again</button></div> : null}
        {loading && !resources.length ? <p role="status" className="py-6 text-sm text-[var(--onboarding-muted,#475569)]">Loading resources…</p> : null}
        {!loading && !error && !resources.length ? <p className="pt-5 text-center text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Files you upload will appear here.<br />Your team will be able to access them.</p> : null}
        {resources.length ? <><h3 className="mt-6 text-sm font-semibold">Uploaded files</h3><List surface="light" embedded ariaLabel="Your uploaded resources">{resources.map((resource) => {
            const href = `${api}/${resource.id}`
            return <ListItem key={resource.id}>
                <ListPrimaryRow><ListTitle href={href} external className="flex-1">{resource.name}</ListTitle><Status surface="light" tone="green" label="Saved" /></ListPrimaryRow>
                <ListSecondaryRow className="text-[var(--onboarding-muted,#475569)]"><span className="shrink-0 text-xs">{resourceSizeLabel(resource.size)}</span><time className="min-w-0 truncate text-xs" dateTime={resource.createdAt}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(resource.createdAt))}</time><ListTrailing><ListPrimaryAction label="Download" accessibleLabel={`Download ${resource.name}`} href={href} download /></ListTrailing></ListSecondaryRow>
            </ListItem>
        })}</List></> : null}
        {hasMore ? <button type="button" disabled={loading} onClick={() => { setLoading(true); void load(resources.length) }} className="mt-4 min-h-11 text-sm font-semibold">{loading ? "Loading…" : "Load more files"}</button> : null}
    </PortalSection>
}
