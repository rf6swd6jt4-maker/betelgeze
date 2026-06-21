"use client"

import Link from "next/link"
import { ChangeEvent, PointerEvent, useRef, useState, useTransition } from "react"

type Props = {
    workspace: { name: string; slug: string; bannerHeight: number; bannerPosition: number; bannerSrc: string | null; logoSrc: string | null }
    updateName: (formData: FormData) => Promise<void>
    updateCoverLayout: (height: number, position: number) => Promise<void>
    uploadBanner: (formData: FormData) => Promise<void>
    uploadLogo: (formData: FormData) => Promise<void>
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))

function PencilIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m13.5 8.5 3 3" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m5 12 4 4L19 6" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m6 6 12 12M18 6 6 18" /></svg> }
function ResizeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m8 10 4-4 4 4M8 14l4 4 4-4" /></svg> }

export function WorkspaceIdentityEditor({ workspace, updateName, updateCoverLayout, uploadBanner, uploadLogo }: Props) {
    const [nameEditing, setNameEditing] = useState(false)
    const [name, setName] = useState(workspace.name)
    const [height, setHeight] = useState(workspace.bannerHeight)
    const [position, setPosition] = useState(workspace.bannerPosition)
    const [pending, startTransition] = useTransition()
    const resizeStart = useRef<{ y: number; height: number } | null>(null)
    const imageStart = useRef<{ y: number; position: number } | null>(null)
    const bannerInput = useRef<HTMLInputElement>(null)
    const logoInput = useRef<HTMLInputElement>(null)
    const [bannerSelected, setBannerSelected] = useState(false)
    const [logoSelected, setLogoSelected] = useState(false)

    function saveCover() { startTransition(() => { void updateCoverLayout(height, position) }) }
    function saveName() { const data = new FormData(); data.set("name", name); startTransition(() => { void updateName(data); setNameEditing(false) }) }
    function upload(input: HTMLInputElement, action: (formData: FormData) => Promise<void>, key: "banner" | "logo") {
        if (!input.files?.[0]) return
        const data = new FormData(); data.set(key, input.files[0]); startTransition(() => { void action(data) })
    }
    function onResizeStart(event: PointerEvent<HTMLButtonElement>) { event.preventDefault(); event.stopPropagation(); resizeStart.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId) }
    function onResizeMove(event: PointerEvent<HTMLButtonElement>) { if (!resizeStart.current) return; setHeight(clamp(resizeStart.current.height + event.clientY - resizeStart.current.y, 192, 288)) }
    function onResizeEnd() { if (!resizeStart.current) return; resizeStart.current = null; saveCover() }
    function onImageStart(event: PointerEvent<HTMLDivElement>) { if (!workspace.bannerSrc || (event.target as HTMLElement).closest("button")) return; imageStart.current = { y: event.clientY, position }; event.currentTarget.setPointerCapture(event.pointerId) }
    function onImageMove(event: PointerEvent<HTMLDivElement>) { if (!imageStart.current) return; setPosition(clamp(imageStart.current.position - ((event.clientY - imageStart.current.y) / Math.max(height, 1)) * 100, 0, 100)) }
    function onImageEnd() { if (!imageStart.current) return; imageStart.current = null; saveCover() }

    return <><div className="group relative mb-16 overflow-visible rounded-xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl" style={{ height }} onPointerDown={onImageStart} onPointerMove={onImageMove} onPointerUp={onImageEnd} onPointerCancel={onImageEnd}>{workspace.bannerSrc ? <img src={workspace.bannerSrc} alt={`${workspace.name} dashboard banner`} className={`h-full w-full rounded-xl object-cover transition-opacity sm:rounded-2xl ${bannerSelected || pending ? "opacity-60" : ""}`} style={{ objectPosition: `50% ${position}%` }} /> : <div className="flex h-full items-center justify-center rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-900 text-sm text-neutral-500 sm:rounded-2xl">Add a workspace banner</div>}<button type="button" onClick={() => bannerInput.current?.click()} aria-label="Replace dashboard banner" className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition hover:bg-black/70"><PencilIcon /></button><input ref={bannerInput} onChange={(event: ChangeEvent<HTMLInputElement>) => { setBannerSelected(true); upload(event.currentTarget, uploadBanner, "banner") }} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /><button type="button" aria-label="Drag to resize banner" title="Drag to resize banner" onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} className="absolute bottom-0 left-1/2 inline-flex h-10 w-10 -translate-x-1/2 translate-y-1/2 touch-none items-center justify-center rounded-full border border-neutral-600 bg-neutral-900 text-neutral-100 shadow-xl transition hover:border-white"><ResizeIcon /></button>{workspace.logoSrc && <img src={workspace.logoSrc} alt={`${workspace.name} logo`} className={`absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover transition-opacity sm:left-7 sm:h-[108px] sm:w-[108px] ${logoSelected || pending ? "opacity-60" : ""}`} />}<button type="button" onClick={() => logoInput.current?.click()} aria-label="Replace company logo" className="absolute bottom-0 left-[88px] inline-flex h-9 w-9 translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur transition hover:bg-black/80 sm:left-[98px]"><PencilIcon /></button><input ref={logoInput} onChange={(event: ChangeEvent<HTMLInputElement>) => { setLogoSelected(true); upload(event.currentTarget, uploadLogo, "logo") }} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></div><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{nameEditing ? <div className="flex items-center gap-2"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Workspace name" autoFocus className="min-h-11 w-full max-w-md rounded-lg border border-neutral-600 bg-neutral-900 px-3 text-2xl font-semibold" /><button onClick={saveName} disabled={pending} aria-label="Save workspace name" className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white text-black"><CheckIcon /></button><button onClick={() => { setName(workspace.name); setNameEditing(false) }} aria-label="Cancel workspace name edit" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-700"><CloseIcon /></button></div> : <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1><button type="button" onClick={() => setNameEditing(true)} aria-label="Edit workspace name" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-white"><PencilIcon /></button></div>}<p className="mt-2 text-sm text-neutral-400">Settings for this workspace.</p></div><span className="text-xs text-neutral-500">{pending ? "Saving changes…" : "Drag the cover to reposition it"}</span></div><nav className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"><Link href={`/dashboard/${workspace.slug}`} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2">Clients</Link><Link href={`/dashboard/${workspace.slug}/invoices`} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2">Invoices</Link><Link href={`/dashboard/${workspace.slug}/health`} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2">System health</Link><Link href={`/dashboard/${workspace.slug}/settings`} className="shrink-0 rounded-lg bg-white px-3 py-2.5 font-medium text-black sm:py-2">Settings</Link></nav></>
}
