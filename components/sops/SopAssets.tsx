"use client"
/* eslint-disable @next/next/no-img-element -- Private originals load only on explicit preview; never use the shared image optimizer. */
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AssetGallery, AssetGalleryCard, CenteredDialog, RoundPill } from "@/components/ui"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"
import { sopFileSize } from "@/lib/sops/policy"
import { interpretationUnavailable, SOP_SOURCE_LABELS, type SopAsset, type SopInterpretationSummary } from "@/lib/sops/records-policy"
import type { SopInterpretation } from "@/lib/sops/interpretation"
import { sopButtonClass, sopCommand } from "./client"
type Interpretation = SopInterpretationSummary & { result: SopInterpretation | null; model: string; input_tokens: number | null; output_tokens: number | null; reviewed_at: string | null }
function AssetRow({ item, job, workspaceSlug, sopId, canEdit, aiReady }: { item: SopAsset; job?: SopInterpretationSummary; workspaceSlug: string; sopId: string; canEdit: boolean; aiReady: boolean }) {
    const router = useRouter(), busyRef = useRef(false), mediaRef = useRef<HTMLMediaElement | null>(null)
    const [opened, setOpened] = useState(false), [preview, setPreview] = useState(false), [interpretation, setInterpretation] = useState<Interpretation | null>(null), [showInterpretation, setShowInterpretation] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
    const { asset } = item, type = asset.content_type
    const url = `/api/workspaces/${workspaceSlug}/sops/${sopId}/assets/${item.asset_id}`, api = `/api/workspaces/${workspaceSlug}/sops/${sopId}/interpretations`
    const unavailable = interpretationUnavailable(asset), previewable = /^(image|video|audio)\//.test(type) || type === "application/pdf"
    useEffect(() => {
        if (!preview) return
        const pauseWhenHidden = () => { if (document.hidden || document.body.dataset.workspaceTabActive === "false") mediaRef.current?.pause() }
        document.addEventListener("visibilitychange", pauseWhenHidden)
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, pauseWhenHidden)
        return () => { document.removeEventListener("visibilitychange", pauseWhenHidden); window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, pauseWhenHidden) }
    }, [preview])
    async function action(fn: () => Promise<void>) {
        if (busyRef.current) return
        busyRef.current = true; setBusy(true); setError("")
        try { await fn() } catch (e) { setError(e instanceof Error ? e.message : "Could not complete request.") }
        finally { busyRef.current = false; setBusy(false) }
    }
    async function read() { if (job) { setInterpretation(await sopCommand(`${api}/${job.id}`, undefined, "GET")); setShowInterpretation(true); router.refresh() } }
    const result = interpretation?.result
    return <><AssetGalleryCard title={asset.title} subtitle={<span>{SOP_SOURCE_LABELS[item.role]}</span>} detail={sopFileSize(asset.file_size)} format={asset.title.split(".").at(-1)} previewUrl={type.startsWith("image/") && asset.file_size <= 2 * 1024 * 1024 ? url : null} onClick={() => { setOpened(true); setPreview(previewable) }} />
        {opened ? <CenteredDialog title={asset.title} wide busy={busy} onClose={() => { setOpened(false); setPreview(false) }}>
        <div>
            <RoundPill>{SOP_SOURCE_LABELS[item.role]}</RoundPill>

            {item.notes ? <p className="mb-2 whitespace-pre-wrap break-words text-sm text-neutral-400">{item.notes}</p> : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-300">
                {canEdit && !unavailable && item.role !== "main" ? <button type="button" disabled={busy} className="min-h-10" onClick={() => void action(async () => { await sopCommand(url, { action: "main" }, "PATCH"); router.refresh() })}>Use as main procedure</button> : null}
                {previewable ? <button type="button" className="min-h-10 hover:text-white" onClick={() => setPreview(value => !value)}>{preview ? "Close preview" : "Preview"}</button> : null}
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center hover:text-white">Open</a>
                <a href={`${url}?download=1`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center hover:text-white">Download</a>
                {job ? <button type="button" disabled={busy} className="min-h-10 disabled:opacity-40" onClick={() => void action(read)}>{busy ? "Loading…" : job.status === "ready" ? "Review interpretation" : job.status === "reviewed" ? "View interpretation" : "Check interpretation"}</button> : null}
                {canEdit && !unavailable && (!job || ["queued", "failed", "running"].includes(job.status)) ? <button type="button" disabled={busy || !aiReady} title={!aiReady ? "OpenAI setup is not enabled" : undefined} className="min-h-10 text-white disabled:opacity-35" onClick={() => void action(async () => { await sopCommand(api, { assetId: item.asset_id, retry: job?.status === "failed" }); router.refresh() })}>{job?.status === "failed" ? "Retry interpretation" : job ? "Resume interpretation" : "Interpret asset"}</button> : null}
                {job ? <span className="text-neutral-500">{job.status === "ready" ? "AI draft · needs review" : job.status === "reviewed" ? "Reviewed" : job.status === "failed" ? "Needs attention" : job.status === "queued" ? "Queued" : "Interpreting"}</span> : null}
            </div>
            {unavailable ? <p className="mt-1 text-xs leading-5 text-neutral-500">{unavailable}</p> : null}
            {job?.error_summary ? <p className="mt-2 text-xs text-amber-200">{job.error_summary}</p> : null}
            {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
            {preview ? <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                {type.startsWith("image/") ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={asset.title} className="max-h-[65dvh] w-full object-contain" /></a> : type.startsWith("video/") ? <video ref={element => { mediaRef.current = element }} src={url} controls preload="metadata" className="max-h-[65dvh] w-full" /> : type.startsWith("audio/") ? <audio ref={element => { mediaRef.current = element }} src={url} controls preload="metadata" className="w-full" /> : <iframe src={url} title={asset.title} className="h-[65dvh] w-full rounded-lg" />}
                <p className="mt-2 text-xs text-neutral-500">If playback is unsupported by your browser, download the original.</p>
            </div> : null}
            {showInterpretation && interpretation ? <section className="mt-4 space-y-4 border-t border-neutral-800 pt-4">
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-white">{interpretation.status === "reviewed" ? "Reviewed interpretation" : "AI interpretation · draft"}</h3><button type="button" onClick={() => setShowInterpretation(false)} className="min-h-10 text-xs text-neutral-500">Close</button></div>
                {!result ? <p className="text-sm text-neutral-400">{interpretation.error_summary || "The interpretation is not ready. Check again shortly."}</p> : <>
                    <p className="whitespace-pre-wrap break-words text-sm text-neutral-300">{result.summary}</p>
                    <p className="text-xs leading-5 text-neutral-500">Check the original source, conditions, examples and omitted guidance before marking this reviewed. Interpretation does not create work items.</p>
                    {result.applicability.length ? <div><h4 className="text-xs font-medium text-neutral-300">Applies when</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-400">{result.applicability.map((value, i) => <li key={i}>{value}</li>)}</ul></div> : null}
                    <ol className="space-y-4">{result.steps.map((step, i) => <li key={i} className="border-l border-neutral-800 pl-3"><p className="text-sm font-medium text-neutral-200">{i + 1}. {step.title} <span className="font-normal text-neutral-500">· {step.kind}</span></p><p className="mt-1 whitespace-pre-wrap text-sm text-neutral-400">{step.instruction}</p>{step.condition ? <p className="mt-1 text-xs text-amber-100/80">When: {step.condition}</p> : null}<blockquote className="mt-2 break-words text-xs text-neutral-500">“{step.source_quote}” · {step.source_location || "Location not identified"}</blockquote></li>)}</ol>
                    {result.missing_information.length ? <div><h4 className="text-xs font-medium text-neutral-300">Information still needed</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-400">{result.missing_information.map((value, i) => <li key={i}>{value}</li>)}</ul></div> : null}
                    {result.warnings.length ? <div><h4 className="text-xs font-medium text-amber-200">Review notes</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-100/70">{result.warnings.map((value, i) => <li key={i}>{value}</li>)}</ul></div> : null}
                    {canEdit && interpretation.status === "ready" ? <button type="button" className={sopButtonClass} disabled={busy} onClick={() => void action(async () => { await sopCommand(`${api}/${interpretation.id}`); await read() })}>Mark reviewed</button> : null}
                </>}
            </section> : null}
        </div>
        </CenteredDialog> : null}</>
}
export function SopAssets({ workspaceSlug, sopId, items, interpretations, next, paged, canEdit, aiReady }: { workspaceSlug: string; sopId: string; items: SopAsset[]; interpretations: SopInterpretationSummary[]; next: string | null; paged: boolean; canEdit: boolean; aiReady: boolean }) {
    return <div className="mt-4">
        {canEdit && !aiReady ? <p className="text-xs text-neutral-500">Asset storage is ready. AI interpretation becomes available after OpenAI setup is enabled.</p> : null}
        {items.length ? <AssetGallery label="SOP assets">{items.map(item => <AssetRow key={item.asset_id} item={item} job={interpretations.find(job => job.asset_id === item.asset_id)} workspaceSlug={workspaceSlug} sopId={sopId} canEdit={canEdit} aiReady={aiReady} />)}</AssetGallery> : <p className="py-6 text-sm text-neutral-500">No assets yet. Add the main SOP document, then any supporting material.</p>}
        {next || paged ? <nav aria-label="SOP asset pages" className="mt-4 flex gap-4 text-sm text-neutral-300">{paged ? <Link prefetch={false} href={`/${workspaceSlug}/sops/${sopId}`}>Newest assets</Link> : null}{next ? <Link prefetch={false} href={`/${workspaceSlug}/sops/${sopId}?cursor=${encodeURIComponent(next)}`}>Older assets</Link> : null}</nav> : null}
    </div>
}
