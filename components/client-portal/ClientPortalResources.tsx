"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { Status } from "@/components/ui"
import { portalResourceFile, resourceSizeLabel, type PortalResource } from "@/lib/client-portal/resources"
import type { StoredUpload } from "@/lib/onboarding/forms"

type UploadTask = { id: string; file: File; progress: number; state: "queued" | "uploading" | "saving" | "failed"; error?: string; upload?: StoredUpload; uploadUrl?: string; uploaded?: boolean }

function putFile(url: string, file: File, onProgress: (progress: number) => void) {
    return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", url)
        xhr.timeout = 30 * 60 * 1000
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)) }
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload did not complete. Please retry."))
        xhr.onerror = () => reject(new Error("Could not reach file storage. Check your connection and retry."))
        xhr.ontimeout = () => reject(new Error("The upload timed out. Please retry."))
        xhr.onabort = () => reject(new Error("The upload was interrupted. Please retry."))
        xhr.send(file)
    })
}

export function ClientPortalResources({ token }: { token: string }) {
    const api = `/api/client-portal/session/${encodeURIComponent(token)}/resources`
    const [resources, setResources] = useState<PortalResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [tasks, setTasks] = useState<UploadTask[]>([])
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const fileInput = useRef<HTMLInputElement>(null)
    const busyRef = useRef(false)

    const load = useCallback(async (offset = 0) => {
        try {
            const response = await fetch(`${api}?offset=${offset}`, { cache: "no-store" })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || "Could not load resources.")
            setResources((current) => offset ? [...current, ...result.resources.filter((item: PortalResource) => !current.some((old) => old.id === item.id))] : result.resources)
            setHasMore(result.hasMore)
            setError(null)
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load resources.") }
        finally { setLoading(false) }
    }, [api])

    useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load() }); return () => { active = false } }, [load])
    useEffect(() => {
        if (!busy) return
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [busy])

    async function run(queue: UploadTask[]) {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setNotice(null)
        let saved = 0
        for (const task of queue) {
            const patch = (changes: Partial<UploadTask>) => {
                Object.assign(task, changes)
                setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...changes } : item))
            }
            try {
                patch({ state: task.uploaded ? "saving" : "uploading", error: undefined })
                if (!task.uploaded) {
                    const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", file: { name: task.file.name, size: task.file.size, type: task.file.type } }) })
                    const result = await response.json()
                    if (!response.ok) throw new Error(result.error || "Could not prepare upload.")
                    patch({ upload: result.storedUpload, uploadUrl: result.uploadUrl })
                    await putFile(result.uploadUrl, task.file, (progress) => patch({ progress }))
                    patch({ uploaded: true, state: "saving", progress: 100 })
                }
                const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", upload: task.upload }) })
                const result = await response.json()
                if (!response.ok) {
                    if (response.status === 400 || response.status === 409) patch({ uploaded: false })
                    throw new Error(result.error || "Could not save your file. Please retry.")
                }
                setResources((current) => [result.resource, ...current.filter((item) => item.id !== result.resource.id)])
                setTasks((current) => current.filter((item) => item.id !== task.id))
                saved++
            } catch (failure) { patch({ state: "failed", error: failure instanceof Error ? failure.message : "Upload failed. Please retry." }) }
        }
        busyRef.current = false
        setBusy(false)
        if (saved) setNotice(`${saved === 1 ? "Your file is" : `${saved} files are`} saved and available to your team.`)
    }

    function select(files: File[]) {
        if (busyRef.current || !files.length) return
        if (files.length > 10) { setNotice("Please choose up to 10 files at a time."); return }
        const invalid = files.find((file) => !portalResourceFile({ name: file.name, size: file.size, type: file.type }))
        if (invalid) { setNotice(`${invalid.name}: choose a non-empty file up to 500 MB.`); return }
        const queue: UploadTask[] = files.map((file) => ({ id: crypto.randomUUID(), file, state: "queued", progress: 0 }))
        setTasks((current) => [...current, ...queue])
        void run(queue)
    }

    return <section id="resources" aria-labelledby="resources-title" className="min-w-0 scroll-mt-6 rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
            <div><h2 id="resources-title" className="text-xl font-semibold tracking-tight">Your resources</h2><p className="mt-1 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Share files with your team.</p></div>
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Uploading…" : "Upload files"}</button>
        </div>
        <input ref={fileInput} type="file" multiple className="hidden" aria-label="Choose resources to upload" onChange={(event) => { select(Array.from(event.target.files ?? [])); event.target.value = "" }} />
        <div onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); select(Array.from(event.dataTransfer.files)) }} className={`mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-sm ${dragging ? "border-[var(--onboarding-primary,#1E3A5F)] bg-black/5" : "border-black/15 bg-black/[0.015]"}`}>
            <p className="font-medium">Documents, photos, videos & more</p><p className="mt-1 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Drop files here or choose Upload files. Up to 500 MB each.</p>
        </div>
        {notice ? <p role="status" className="mt-3 text-sm leading-6">{notice}</p> : null}
        {busy ? <p role="status" className="mt-3 text-xs text-[var(--onboarding-muted,#475569)]">Keep this page open until your files are saved.</p> : null}
        {tasks.length ? <List surface="light" ariaLabel="Uploads in progress">{tasks.map((task) => <ListItem key={task.id}>
            <ListPrimaryRow><ListTitle className="flex-1">{task.file.name}</ListTitle><Status surface="light" tone={task.state === "failed" ? "red" : "yellow"} label={task.state === "failed" ? "Failed" : task.state === "saving" ? "Saving" : task.state === "queued" ? "Queued" : `${task.progress}%`} /></ListPrimaryRow>
            <ListSecondaryRow><span title={task.error} className="min-w-0 truncate text-xs text-[var(--onboarding-muted,#475569)]">{task.error || resourceSizeLabel(task.file.size)}</span>{task.state === "failed" ? <ListTrailing><button disabled={busy} type="button" className="font-semibold disabled:opacity-40" onClick={() => void run([task])}>Retry</button></ListTrailing> : null}</ListSecondaryRow>
        </ListItem>)}</List> : null}
        {error ? <div role="alert" className="mt-4 text-sm text-red-700">{error} <button type="button" onClick={() => { setLoading(true); void load() }} className="underline">Try again</button></div> : null}
        {loading && !resources.length ? <p role="status" className="py-6 text-sm text-[var(--onboarding-muted,#475569)]">Loading resources…</p> : null}
        {!loading && !error && !resources.length ? <p className="pt-5 text-sm text-[var(--onboarding-muted,#475569)]">Your uploaded files will appear here.</p> : null}
        {resources.length ? <List surface="light" ariaLabel="Your uploaded resources">{resources.map((resource) => {
            const href = `${api}/${resource.id}`
            const actions = [{ label: "Download file", href, external: true }]
            return <ListItem key={resource.id}><MobileListActionSurface actions={actions} label={`Actions for ${resource.name}`}>
                <ListPrimaryRow><ListTitle href={href} external className="flex-1">{resource.name}</ListTitle><Status surface="light" tone="green" label="Saved" /></ListPrimaryRow>
                <ListSecondaryRow className="text-[var(--onboarding-muted,#475569)]"><span className="text-xs">{resource.id.slice(0, 6)}</span><span className="text-xs">{resourceSizeLabel(resource.size)}</span><ListTrailing><time className="text-xs" dateTime={resource.createdAt}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(resource.createdAt))}</time><ListActionMenu actions={actions} className="hidden sm:inline-flex" /></ListTrailing></ListSecondaryRow>
            </MobileListActionSurface></ListItem>
        })}</List> : null}
        {hasMore ? <button type="button" disabled={loading} onClick={() => { setLoading(true); void load(resources.length) }} className="mt-4 min-h-11 text-sm font-semibold">{loading ? "Loading…" : "Load more files"}</button> : null}
    </section>
}
