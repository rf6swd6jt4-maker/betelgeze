"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import { AttachmentCard, AttachmentCards, AddAttachmentCard, CenteredDialog, Status } from "@/components/ui"
import { CommunicationMethodMark } from "@/components/ui/CommunicationMethod"
import { List, ListItem, ListPrimaryRow, ListTitle } from "@/components/list/List"
import { useRelationshipBackground } from "./RelationshipBackgroundEditor"
import { useRouter, useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { attachRelationshipContact, requestRelationshipContactConfirmation } from "@/app/[workspaceSlug]/relationships/contact-actions"
import { contactMethodName, type MessagingChoice, type MessagingMethod, type RelationshipContacts } from "@/lib/relationship-contacts"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

type Method = MessagingMethod | "email" | "phone" | "portal"
const inputClass = "mt-2 min-h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-base text-white"
export function ContactThumbnail({ method }: { method: Method }) {
    return <span className="flex h-full w-full items-center justify-center">{method === "meta_whatsapp" || method === "twilio_sms" || method === "phone" ? <CommunicationMethodMark method={method} size="lg" /> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="block h-8 w-8">{method === "email" ? <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></> : <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></>}</svg>}</span>
}
export function RelationshipContactCards({ workspaceSlug, relationshipId, userId, revision, canAdd }: {
    workspaceSlug: string; relationshipId: string; userId: string; revision: unknown; canAdd: boolean
}) {
    const background = useRelationshipBackground()
    const router = useRouter()
    const active = useWorkspaceNavigation()?.active ?? true
    const endpoint = `/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/contacts`
    const host = useRef<HTMLElement>(null)
    const [visible, setVisible] = useState(false)
    const [data, setData] = useState<RelationshipContacts | null>(null)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [retry, setRetry] = useState(0)
    const [opened, setOpened] = useState<Method | "add" | null>(null)
    const [adding, setAdding] = useState(false)
    const [latest, setLatest] = useState<{ created_at: string; direction: string; status: string } | null>(null)
    const [latestError, setLatestError] = useState("")
    const [latestLoading, setLatestLoading] = useState(false)
    const [busy, startTransition] = useTransition()
    const requestId = useRef("")
    useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: "160px" }); if (host.current) observer.observe(host.current); return () => observer.disconnect() }, [])
    useEffect(() => {
        if (!visible || !active) return
        const controller = new AbortController()
        fetch(endpoint, { headers: { "x-workspace-user": userId }, cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value }).then(value => { if (!controller.signal.aborted) { setData(value); setError("") } }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [endpoint, userId, active, visible, revision, retry])
    useEffect(() => {
        if (opened !== "meta_whatsapp" && opened !== "twilio_sms") return
        const controller = new AbortController()
        fetch(`${endpoint}?method=${opened}`, { headers: { "x-workspace-user": userId }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value }).then(value => { if (!controller.signal.aborted) { setLatest(value.latest); setLatestLoading(false) } }).catch(() => { if (!controller.signal.aborted) { setLatestError("Last message information unavailable"); setLatestLoading(false) } })
        return () => controller.abort()
    }, [endpoint, opened, userId])
    function open(method: Method | "add", add = false) { setOpened(method); setAdding(add); setLatest(null); setLatestLoading(method === "meta_whatsapp" || method === "twilio_sms"); setLatestError(""); setNotice(""); requestId.current = crypto.randomUUID() }
    const choices = data?.choices ?? []
    const methods: Method[] = [ ...(background.draft.primaryEmail ? ["email" as const] : []), ...(background.draft.primaryPhone ? ["phone" as const] : []), ...choices.filter(choice => choice.added).map(choice => choice.provider), ...(data?.portal ? ["portal" as const] : []) ]
    const selected = choices.find(choice => choice.provider === opened)
    const field = opened === "email" ? "primaryEmail" : opened === "meta_whatsapp" ? "whatsappPhone" : "primaryPhone"
    const address = opened === "portal" ? data?.portal?.url : background.draft[field]
    async function copy(value: string) { try { await navigator.clipboard.writeText(value); setNotice("Copied") } catch { setNotice("Could not copy. Select and copy the address above.") } }
    function saveContact() {
        startTransition(async () => {
            try {
                await background.flush()
                if (opened === "meta_whatsapp" || opened === "twilio_sms") {
                    const result = await runWorkspaceMutation(() => attachRelationshipContact(workspaceSlug, relationshipId, userId, opened))
                    if (!result.ok) throw new Error(result.error)
                }
                setAdding(false); setNotice("Contact saved"); setRetry(value => value + 1); router.refresh()
            } catch (error) { setNotice(error instanceof Error ? error.message : "Contact could not be saved.") }
        })
    }
    return <section ref={host} className="mt-6" aria-label="Relationship contacts"><h2 className="mb-3 text-base font-semibold">Contact</h2>
        <AttachmentCards label="Contact methods" compact>{methods.map(method => { const choice = choices.find(choice => choice.provider === method); const broken = choice?.state === "broken" || method === "portal" && !data?.portal?.active; return <AttachmentCard compact key={method} title={contactMethodName(method)} thumbnail={<ContactThumbnail method={method} />} inactive={choice?.state === "inactive"} broken={broken} subtitle={method === "email" ? background.draft.primaryEmail : method === "phone" ? background.draft.primaryPhone : method === "portal" ? broken ? "Unavailable" : "Client access" : choice?.state === "active" ? "Confirmed" : broken ? "Needs attention" : "Not confirmed"} onClick={() => open(method)} /> })}{canAdd ? <AddAttachmentCard compact label="Add contact" onClick={() => open("add")} /> : null}</AttachmentCards>
        {!data && !error ? <p className="mt-2 text-xs text-neutral-500">Checking connections…</p> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error} <button className="min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
        {opened ? <CenteredDialog title={opened === "add" ? "Add contact" : contactMethodName(opened)} busy={busy} onClose={() => { setOpened(null); void background.flush().catch(() => {}) }}>
            {opened === "add" ? <List ariaLabel="Available contact methods">{(["email", "phone", "meta_whatsapp", "twilio_sms"] as Method[]).filter(method => !methods.includes(method)).map(method => <ListItem key={method}><button className="w-full text-left" onClick={() => open(method, true)}><ListPrimaryRow><span className="mr-3 flex h-10 w-10 items-center justify-center"><ContactThumbnail method={method} /></span><ListTitle>{contactMethodName(method)}</ListTitle></ListPrimaryRow></button></ListItem>)}{["email", "phone", "meta_whatsapp", "twilio_sms"].every(method => methods.includes(method as Method)) ? <p className="p-3 text-sm text-neutral-400">All supported contact methods are added.</p> : null}</List> : <>
                {opened !== "portal" && (adding || background.canEdit) ? <label className="block text-sm text-neutral-400">{opened === "email" ? "Email address" : "Phone number"}<input aria-label={`${contactMethodName(opened)} address`} type={opened === "email" ? "email" : "tel"} autoComplete={opened === "email" ? "email" : "tel"} maxLength={320} value={background.draft[field]} onChange={event => background.update(field, event.target.value)} onBlur={() => { if (!adding) void background.flush().catch(() => {}) }} className={inputClass} /></label> : <p className="select-all truncate text-sm text-neutral-200" title={address ?? ""}>{address ?? "Link unavailable"}</p>}
                <div className="mt-3 flex flex-wrap gap-4 text-sm">{address ? <button className="min-h-11 underline" onClick={() => void copy(address)}>Copy {opened === "portal" ? "link" : opened === "email" ? "email" : "number"}</button> : null}{opened === "email" && address ? <a className="inline-flex min-h-11 items-center underline" href={`mailto:${address}`}>Email</a> : null}{opened === "phone" && address ? <a className="inline-flex min-h-11 items-center underline" href={`tel:${address}`}>Call</a> : null}</div>
                {selected ? <ContactFacts choice={selected} latest={latest} latestError={latestError} latestLoading={latestLoading} /> : null}
                {opened === "portal" && data?.portal ? <p className="mt-3 text-sm text-neutral-400">Created {new Date(data.portal.createdAt).toLocaleString()} · {data.portal.active ? "Active" : "Unavailable"}</p> : null}
                {adding ? <button disabled={busy || !address?.trim()} onClick={saveContact} className="mt-4 min-h-11 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{busy ? "Saving…" : "Add contact"}</button> : selected && (selected.state !== "active" || !selected.canSend) && canAdd ? <button disabled={busy || !selected.enabled || selected.state === "broken"} onClick={() => startTransition(async () => { try { await background.flush(); const result = await runWorkspaceMutation(() => requestRelationshipContactConfirmation(workspaceSlug, relationshipId, userId, selected.provider, requestId.current)); setNotice(result.ok ? result.notice ?? "Confirmation requested" : result.error ?? "Confirmation failed"); setRetry(value => value + 1) } catch { setNotice("Could not confirm the result. Check Comms before retrying.") } })} className="mt-4 min-h-11 rounded-lg border border-neutral-700 px-4 text-sm disabled:opacity-40">{busy ? "Requesting…" : "Send confirmation"}</button> : null}
                {notice ? <p role="status" className="mt-3 text-sm text-neutral-300">{notice}</p> : null}
            </>}
        </CenteredDialog> : null}
    </section>
}
function ContactFacts({ choice, latest, latestError, latestLoading }: { choice: MessagingChoice; latest: { created_at: string; direction: string; status: string } | null; latestError: string; latestLoading: boolean }) {
    return <div className="space-y-2 text-sm text-neutral-400"><Status tone={choice.state === "active" ? "green" : choice.state === "broken" ? "red" : "grey"} label={choice.state === "active" ? "Confirmed" : choice.state === "broken" ? "Connection needs attention" : choice.confirmationStatus === "awaiting_confirmation" ? "Waiting for confirmation" : "Not confirmed"} />{choice.confirmedAt ? <p>Confirmed {new Date(choice.confirmedAt).toLocaleString()}</p> : null}{!choice.enabled ? <p>Connect this provider in Settings.</p> : !choice.optedIn ? <p>The client must use your workspace’s SMS opt-in page before a confirmation can be sent.</p> : null}{choice.state === "active" && !choice.canSend ? <p>A new client reply is needed before sending an onboarding link. Send a confirmation to ask them to reply.</p> : null}{latest ? <p>Last {latest.direction === "inbound" ? "incoming" : "outgoing"} message · {new Date(latest.created_at).toLocaleString()} · {latest.status.replaceAll("_", " ")}</p> : <p className="text-xs">{latestLoading ? "Checking last message…" : latestError || "No message history"}</p>}</div>
}
