"use client"

import { useEffect, useRef, useState } from "react"
import { Assignee, RelationshipStage, RoundPill } from "@/components/ui"
import { QuickStats } from "@/components/panel/QuickStats"
import { shortId } from "@/lib/ui/relative-time"
import { RELATIONSHIP_PHASES } from "@/lib/relationship-phases"
import { relationshipContactHref, relationshipContextDestinations } from "@/lib/relationship-context"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

type Props = {
    context: WorkspaceTabRelationshipContext
    workspaceSlug: string
    onNavigate: (href: string) => void
    workspaceCapabilities: WorkspaceCapability[]
    desktopOpen: boolean
    mobileOpen: boolean
    onClose: () => void
    standalone?: boolean
}

function ContactValue({ label, value }: { label: "Phone" | "Email" | "Website"; value: string }) {
    const [feedback, setFeedback] = useState("")
    const href = relationshipContactHref(label, value)
    useEffect(() => {
        if (!feedback) return
        const timeout = window.setTimeout(() => setFeedback(""), 2400)
        return () => window.clearTimeout(timeout)
    }, [feedback])
    return <div className="py-2">
        <dt className="text-xs text-neutral-500">{label}</dt>
        <dd className="mt-1 flex items-start gap-2 text-sm">
            {href ? <a href={href} target={label === "Website" ? "_blank" : undefined} rel={label === "Website" ? "noopener noreferrer" : undefined} className="min-w-0 flex-1 break-words text-neutral-200 underline decoration-neutral-700 underline-offset-4 hover:text-white">{value}</a>
                : <span className="min-w-0 flex-1 break-words text-neutral-300">{value}</span>}
            <button data-icon-button type="button" title={`Copy ${label.toLowerCase()}`} aria-label={`Copy ${label.toLowerCase()}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-neutral-500 hover:text-white focus-visible:outline focus-visible:outline-neutral-400" onClick={async () => {
                try { await navigator.clipboard.writeText(value); setFeedback(`${label} copied`) }
                catch { setFeedback("Could not copy. Select the text to copy it.") }
            }}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="h-4 w-4"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M12 4V3H3v9h1" /></svg>
            </button>
        </dd>
        {feedback ? <p role="status" className="mt-1 text-xs text-neutral-400">{feedback}</p> : null}
    </div>
}

function ContextContent({ context, workspaceSlug, workspaceCapabilities, onNavigate, onClose }: Pick<Props, "context" | "workspaceSlug" | "workspaceCapabilities" | "onNavigate"> & { onClose?: () => void }) {
    const company = context.business_name?.trim()
    const phase = RELATIONSHIP_PHASES.find((phase) => phase.key === context.lifecycle_phase)?.key
    const details = [
        { label: "Industry", value: context.industry_value?.replace(/_/g, " ") },
        { label: "Location", value: context.location_value?.replace(/_/g, " ") },
        { label: "Source", value: context.source_label },
    ].filter((detail) => detail.value?.trim())
    const contacts = [
        { label: "Email" as const, value: context.primary_email },
        { label: "Phone" as const, value: context.primary_phone },
        { label: "Website" as const, value: context.website_url },
    ].filter((contact) => contact.value?.trim())
    const shortcuts = relationshipContextDestinations.filter((destination) => workspaceCapabilities.includes(destination.capability)
        && context.allowedDestinations?.includes(destination.key))

    return <>
        <header className="shrink-0 border-b border-neutral-900 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">Relationship context <span className="ml-1 font-mono text-neutral-600">{shortId(context.id)}</span></p>
                {onClose ? <button data-icon-button type="button" autoFocus onClick={onClose} aria-label="Close relationship context" className="inline-flex h-8 w-8 items-center justify-center text-xl text-neutral-400 hover:text-white">×</button> : null}
            </div>
            <h2 className="mt-2 break-words text-sm font-semibold">{company || context.primary_person_name}</h2>
            {company || context.primary_contact_role?.trim() ? <p className="mt-1 break-words text-xs leading-5 text-neutral-400">{[company ? context.primary_person_name : null, context.primary_contact_role?.trim()].filter(Boolean).join(" · ")}</p> : null}
            {phase ? <div className="mt-2"><RelationshipStage phase={phase} /></div> : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            <section aria-label="Services and team">
                <h3 className="text-xs font-medium text-neutral-400">Services and team</h3>
                {context.teamUnavailable ? <p className="mt-2 text-xs text-neutral-500">Services and team could not be loaded. Reload to try again.</p> : <>
                    <div className="mt-3"><p className="mb-1.5 text-xs text-neutral-500">Fulfilment manager</p>{context.manager ? <Assignee name={context.manager.name} avatarSrc={context.manager.avatarSrc} /> : <span className="text-xs text-neutral-400">Unassigned</span>}</div>
                    {/* These are attached service/assignee field pairs, not a navigable record collection. */}
                    <dl className="mt-3 divide-y divide-neutral-900">
                        {context.services?.map((service) => <div key={service.id} className="py-2.5">
                            <dt className="min-w-0"><RoundPill tone="emerald">{service.name}</RoundPill></dt>
                            <dd className="mt-1.5">{service.assignee ? <Assignee name={service.assignee.name} avatarSrc={service.assignee.avatarSrc} /> : <span className="text-xs text-neutral-400">Unassigned</span>}</dd>
                        </div>)}
                    </dl>
                    {!context.services?.length ? <p className="mt-2 text-xs text-neutral-500">No services available to show.</p> : null}
                </>}
            </section>

            {context.notes_summary?.trim() ? <section className="mt-4 border-t border-neutral-900 pt-3">
                <h3 className="text-xs font-medium text-neutral-400">Relationship notes</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-300">{context.notes_summary.trim()}</p>
            </section> : null}

            {contacts.length ? <section className="mt-4 border-t border-neutral-900 pt-3">
                <h3 className="text-xs font-medium text-neutral-400">Contact</h3>
                <dl>{contacts.map((contact) => <ContactValue key={`${context.id}-${contact.label}-${contact.value}`} label={contact.label} value={contact.value!.trim()} />)}</dl>
            </section> : null}

            {details.length ? <details className="mt-4 border-t border-neutral-900 pt-3">
                <summary className="cursor-pointer text-xs text-neutral-400 hover:text-white">More details</summary>
                <dl className="mt-2 space-y-2">{details.map((detail) => <div key={detail.label} className="flex gap-3 text-xs leading-5"><dt className="w-16 shrink-0 text-neutral-500">{detail.label}</dt><dd className="min-w-0 break-words text-neutral-300">{detail.value}</dd></div>)}</dl>
            </details> : null}
            {context.metrics.length ? <QuickStats items={context.metrics} ariaLabel="Current view" /> : null}
        </div>

        {shortcuts.length ? <nav aria-label="Relationship shortcuts" className="shrink-0 border-t border-neutral-800 px-4 py-2">
            {shortcuts.map((destination) => <button key={destination.key} type="button" onClick={() => onNavigate(`/${workspaceSlug}/${destination.path}/${context.id}`)} className="flex min-h-9 w-full items-center justify-between gap-2 py-1.5 text-left text-xs text-neutral-300 hover:text-white">
                {destination.label}<span aria-hidden="true" className="text-neutral-500">↗</span>
            </button>)}
        </nav> : null}
    </>
}

export function ShellRelationshipContextPanel({ desktopOpen, mobileOpen, onClose, standalone, ...props }: Props) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])
    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return
        if (mobileOpen) dialog.showModal()
        else dialog.close()
        const media = window.matchMedia("(min-width: 1024px)")
        function closeOnDesktop() { if (media.matches && dialog?.open) onCloseRef.current() }
        closeOnDesktop()
        media.addEventListener("change", closeOnDesktop)
        return () => { media.removeEventListener("change", closeOnDesktop); dialog.close() }
    }, [mobileOpen])

    return <>
        {desktopOpen ? <aside aria-label="Relationship context" className={`fixed right-4 z-[35] hidden w-80 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-white shadow-lg shadow-black/20 sm:right-6 lg:flex ${standalone ? "top-6 h-[calc(100dvh-3rem)]" : "top-[7.75rem] h-[calc(100dvh-9.25rem)]"}`}>
            <ContextContent {...props} />
        </aside> : null}
        <dialog ref={dialogRef} aria-label="Relationship context" onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
            if (event.target !== event.currentTarget) return
            const rect = event.currentTarget.getBoundingClientRect()
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
        }} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(24rem,100vw)] max-w-none border-l border-neutral-800 bg-neutral-950 p-0 text-white backdrop:bg-black/60">
            {mobileOpen ? <div className="betelgeze-popup-enter flex h-full flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"><ContextContent {...props} onClose={onClose} /></div> : null}
        </dialog>
    </>
}
