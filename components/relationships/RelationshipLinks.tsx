"use client"

import { useEffect, useRef, useState, type MouseEvent } from "react"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { Button } from "@/components/ui/Button"
import { SectionHeading } from "@/components/detail"
import { checkRelationshipPortalWhatsAppReadiness, generateRelationshipPortalLink, sendRelationshipPortalLinkOnWhatsApp } from "@/app/[workspaceSlug]/relationships/[relationshipId]/link-actions"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

type Links = {
    sold: boolean
    onboardingAvailable: boolean
    onboardingSessions: Array<{ id: string; status: string; isTest: boolean; createdAt: string; url: string }>
    canGeneratePortal: boolean
    portal: { id: string; url: string; createdAt: string; lastAccessedAt: string | null } | null
}
const retained = new Map<string, { links: Links; at: number }>()

export function RelationshipLinks({ workspaceSlug, relationshipId, userId, rows = false }: { workspaceSlug: string; relationshipId: string; userId: string
    /** The client page's form: two one-line rows that open the same popups, instead of two cards. */
    rows?: boolean }) {
    const sectionRef = useRef<HTMLElement>(null)
    const [visible, setVisible] = useState(false)
    const navigation = useWorkspaceNavigation()
    const active = navigation?.active !== false
    const key = `${userId}:${workspaceSlug}:${relationshipId}`
    const [links, setLinks] = useState<Links | null>(() => retained.get(key)?.links ?? null)
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [panel, setPanel] = useState<"onboarding" | "portal" | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sendStatus, setSendStatus] = useState<string | null>(null)
    const [whatsAppReady, setWhatsAppReady] = useState(false)
    const [whatsAppReason, setWhatsAppReason] = useState<string | null>(null)
    const [checkingWhatsApp, setCheckingWhatsApp] = useState(false)
    const sendRequestId = useRef<string | null>(null)
    useEffect(() => {
        const node = sectionRef.current
        if (!node) return
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: "240px" })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    useEffect(() => {
        if (!active || !visible) return
        const previous = retained.get(key)
        if (previous && Date.now() - previous.at < 60_000) return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/links`, { cache: "no-store", signal: controller.signal, headers: { "x-workspace-user": userId } }).then(async (response) => {
            if (!response.ok) throw new Error(response.status === 403 ? "Only workspace admins can manage client links." : "Client links could not load.")
            return response.json() as Promise<Links>
        }).then((next) => { retained.set(key, { links: next, at: Date.now() }); setLinks(next); setError(null) }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Client links could not load.") })
        return () => controller.abort()
    }, [active, visible, key, workspaceSlug, relationshipId, userId])

    const checkWhatsApp = async () => {
        setWhatsAppReady(false); setWhatsAppReason(null); setCheckingWhatsApp(true)
        try {
            const result = await runWorkspaceMutation(() => checkRelationshipPortalWhatsAppReadiness(workspaceSlug, relationshipId), { category: "communications" })
            setWhatsAppReady(result.ready)
            setWhatsAppReason(result.reason)
        } catch { setWhatsAppReason("WhatsApp readiness could not be checked. Reopen this card to retry.") }
        finally { setCheckingWhatsApp(false) }
    }
    const open = (event: MouseEvent<HTMLButtonElement>, target: "onboarding" | "portal") => {
        setAnchor(event.currentTarget); setPanel(target); setError(null)
        if (target === "portal" && links?.portal) void checkWhatsApp()
    }
    const generate = async () => {
        setBusy(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => generateRelationshipPortalLink(workspaceSlug, relationshipId), { category: "onboarding" })
            if (!result.ok) { setError(result.error); return }
            retained.set(key, { links: result.links, at: Date.now() }); setLinks(result.links)
            void checkWhatsApp()
        } catch { setError("The portal link could not be generated. Try again.") }
        finally { setBusy(false) }
    }
    const copy = async (url: string) => {
        try { await navigator.clipboard.writeText(url); setError(null) }
        catch { setError("Copy failed. Open the link and copy it from the address bar.") }
    }
    const sendOnWhatsApp = async () => {
        if (!links?.portal || busy || !whatsAppReady) return
        setBusy(true); setError(null); setSendStatus(null)
        sendRequestId.current ??= crypto.randomUUID()
        try {
            const result = await runWorkspaceMutation(() => sendRelationshipPortalLinkOnWhatsApp(workspaceSlug, relationshipId, sendRequestId.current!), { category: "communications" })
            if (!result.ok) { setError(result.error); if (!result.error.includes("did not confirm") && !result.error.includes("Check Comms")) sendRequestId.current = null; return }
            setSendStatus(result.status === "sent" ? "Portal link sent via WhatsApp." : "Portal link queued for WhatsApp delivery.")
            sendRequestId.current = null
        } catch { setError("The send status is unknown. Check Comms before sending again.") }
        finally { setBusy(false) }
    }
    const onboardingNote = links?.onboardingAvailable ? `${links.onboardingSessions.length} available session${links.onboardingSessions.length === 1 ? "" : "s"}` : links?.sold ? "Available when onboarding starts" : "Available after services are sold"
    const portalNote = links?.portal ? "Ready to share" : links?.canGeneratePortal ? "Generate secure access" : "Available after onboarding"
    const rowClass = "flex min-h-10 w-full min-w-0 items-center gap-3 px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
    return <section ref={sectionRef} className={rows ? undefined : "mt-5"} aria-label="Client access links" data-client-links={rows ? "" : undefined}>
        {rows ? <>
            <SectionHeading>Access links</SectionHeading>
            <div className="-mx-2 divide-y divide-card-border border-y border-card-border">
                <button type="button" data-icon-button disabled={!links?.onboardingAvailable} onClick={(event) => open(event, "onboarding")} className={rowClass}><span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">Onboarding link</span><span className="shrink-0 text-neutral-500">{links ? onboardingNote : "Checking…"}</span></button>
                <button type="button" data-icon-button disabled={!links?.portal && !links?.canGeneratePortal} onClick={(event) => open(event, "portal")} className={rowClass}><span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">Client portal link</span><span className="shrink-0 text-neutral-500">{links ? portalNote : "Checking…"}</span></button>
            </div>
        </> : <><h2 className="text-sm font-medium text-neutral-300">Client access links</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!links?.onboardingAvailable} onClick={(event) => open(event, "onboarding")} className="min-h-28 rounded-xl border border-card-border p-4 text-left transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:border-neutral-900 disabled:bg-neutral-900/50 disabled:text-neutral-600">
                <span className="block text-sm font-semibold">Onboarding link</span><span className="mt-2 block text-xs text-neutral-500">{links?.onboardingAvailable ? `${links.onboardingSessions.length} available session${links.onboardingSessions.length === 1 ? "" : "s"}` : links?.sold ? "Available when onboarding starts" : "Available after services are sold"}</span>
            </button>
            <button type="button" disabled={!links?.portal && !links?.canGeneratePortal} onClick={(event) => open(event, "portal")} className="min-h-28 rounded-xl border border-card-border p-4 text-left transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:border-neutral-900 disabled:bg-neutral-900/50 disabled:text-neutral-600">
                <span className="block text-sm font-semibold">Client portal link</span><span className="mt-2 block text-xs text-neutral-500">{links?.portal ? "Ready to share" : links?.canGeneratePortal ? "Generate secure access" : "Available after onboarding"}</span>
            </button>
        </div></>}
        {error && !anchor ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
        {anchor && panel && links ? <AnchoredPopup anchor={anchor} onDismiss={() => { setPanel(null); setAnchor(null) }} role="dialog" className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-popup">
            <h3 className="text-sm font-semibold text-white">{panel === "onboarding" ? "Onboarding sessions" : "Client portal"}</h3>
            {panel === "onboarding" ? <div className="mt-3 space-y-2">{links.onboardingSessions.map((session) => <div key={session.id} className="rounded-lg border border-card-border p-2 text-xs"><p className="text-neutral-300">{session.isTest ? "Test · " : ""}{session.status === "completed" ? "Completed" : "Active"} · {new Date(session.createdAt).toLocaleDateString("en-IE")}</p><div className="mt-2 flex gap-3"><a href={session.url} target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">Open</a><button type="button" onClick={() => void copy(session.url)} className="text-neutral-300 underline underline-offset-4">Copy link</button></div></div>)}</div> : links.portal ? <div className="mt-3 space-y-3 text-xs"><p className="text-neutral-400">Created {new Date(links.portal.createdAt).toLocaleDateString("en-IE")}</p><div className="flex gap-3"><a href={links.portal.url} target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-4">Open</a><button type="button" onClick={() => void copy(links.portal!.url)} className="text-neutral-300 underline underline-offset-4">Copy link</button></div><div className="border-t border-card-border pt-3"><Button variant="secondary" size="sm" disabled={busy || checkingWhatsApp || !whatsAppReady} onClick={() => void sendOnWhatsApp()}>{busy ? "Sending…" : "Send via WhatsApp template"}</Button><p className="mt-2 text-neutral-500">{checkingWhatsApp ? "Checking WhatsApp template…" : whatsAppReason ?? "Approved portal Utility template ready."}</p>{sendStatus ? <p role="status" className="mt-2 text-emerald-300">{sendStatus}</p> : null}</div></div> : <div className="mt-3"><p className="text-xs leading-5 text-neutral-400">Create a secure portal link for this client.</p><Button size="sm" className="mt-3" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate link"}</Button></div>}
            {error ? <p role="alert" className="mt-3 text-xs text-red-300">{error}</p> : null}
        </AnchoredPopup> : null}
    </section>
}
