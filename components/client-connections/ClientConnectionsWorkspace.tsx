"use client"

import Link from "next/link"
import { useSearchParams } from "@/components/workspace/WorkspaceNavigation"
import { useMemo, useState, useTransition, useRef, useEffect, type FormEvent } from "react"
import { saveClientAccount, removeClientAccount, refreshClientAccount } from "@/app/[workspaceSlug]/client-connections/actions"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { AnchoredPopup, CenteredDialog, Selector, Status } from "@/components/ui"
import type { ClientConnectionAccount } from "@/lib/client-connections"

const field = "mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-400"

export function ClientConnectionsWorkspace({ workspaceSlug, accounts: initialAccounts, agency, canManageAgency }: {
    workspaceSlug: string
    accounts: ClientConnectionAccount[]
    agency: { connected: boolean; name: string | null; id: string | null }
    canManageAgency: boolean
}) {
    const [accounts, setAccounts] = useState(initialAccounts)
    const [editing, setEditing] = useState<ClientConnectionAccount | null>(null)
    const [removing, setRemoving] = useState<ClientConnectionAccount | null>(null)
    const [menu, setMenu] = useState<{ account: ClientConnectionAccount; anchor: HTMLElement; point?: { x: number; y: number } } | null>(null)
    const [locationId, setLocationId] = useState("")
    const [privateToken, setPrivateToken] = useState("")
    const [calendarId, setCalendarId] = useState("")
    const [calendars, setCalendars] = useState<{ id: string; name: string }[] | null>(null)
    const [loadingCalendars, setLoadingCalendars] = useState(false)
    const calendarRequest = useRef<AbortController | null>(null)
    useEffect(() => () => calendarRequest.current?.abort(), [])
    const selectedRelationship = useSearchParams().get("relationship")
    const visibleAccounts = useMemo(() => selectedRelationship ? accounts.filter(account => account.relationshipId === selectedRelationship) : accounts, [accounts, selectedRelationship])
    const unconnected = useMemo(() => visibleAccounts.filter((account) => !account.connected), [visibleAccounts])
    const [connectionChoices, setConnectionChoices] = useState<ClientConnectionAccount[]>([])
    const [open, setOpen] = useState(false)
    const [relationshipId, setRelationshipId] = useState("")
    const [accountType, setAccountType] = useState<"client_account" | "agency_subaccount">("client_account")
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function clearCalendars() {
        calendarRequest.current?.abort(); calendarRequest.current = null
        setLoadingCalendars(false); setCalendars(null); setCalendarId("")
    }
    function closeEditor() { clearCalendars(); setPrivateToken(""); setOpen(false) }
    function edit(account: ClientConnectionAccount | null) {
        clearCalendars(); setMenu(null); setEditing(account); setError(null); setPrivateToken("")
        setConnectionChoices(account ? [account] : unconnected)
        setRelationshipId(account?.relationshipId ?? unconnected[0]?.relationshipId ?? "")
        setAccountType(account?.accountType ?? "client_account"); setLocationId(account?.locationId ?? "")
        setCalendarId(account?.calendarId ?? ""); setOpen(true)
    }
    async function loadCalendars() {
        calendarRequest.current?.abort()
        const controller = new AbortController(); calendarRequest.current = controller
        const timeout = setTimeout(() => controller.abort(), 30_000)
        setLoadingCalendars(true); setError(null)
        try {
            const response = await fetch(`/api/workspaces/${workspaceSlug}/client-connections/calendars`, {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
                body: JSON.stringify({ relationshipId, locationId, privateToken, expectedRevision: editing?.revision ?? null }),
            })
            const result = await response.json()
            if (calendarRequest.current !== controller) return
            if (!response.ok) throw new Error(result.error ?? "Calendars could not be loaded.")
            setCalendars(result.calendars)
            setCalendarId(result.calendars.some((item: { id: string }) => item.id === calendarId) ? calendarId : "")
        } catch (error) {
            if (calendarRequest.current === controller) setError(controller.signal.aborted ? "Calendar loading timed out. Try again." : error instanceof Error ? error.message : "Calendars could not be loaded.")
        } finally { clearTimeout(timeout); if (calendarRequest.current === controller) { calendarRequest.current = null; setLoadingCalendars(false) } }
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(null)
        startTransition(async () => {
            const result = await saveClientAccount(workspaceSlug, { relationshipId, accountType, locationId, privateToken, calendarId, expectedRevision: editing?.revision ?? null })
            if (!result.ok) { setError(result.error); return }
            setAccounts(result.accounts); closeEditor()
        })
    }
    function refresh(relationshipId: string) {
        setError(null)
        startTransition(async () => {
            const result = await refreshClientAccount(workspaceSlug, relationshipId)
            if (!result.ok) { setError(result.error); return }
            if (result.accounts) setAccounts(result.accounts)
        })
    }
    function remove() {
        if (!removing?.revision) return
        setError(null)
        startTransition(async () => {
            const result = await removeClientAccount(workspaceSlug, removing.relationshipId, removing.revision!)
            if (!result.ok) { setError(result.error); return }
            setAccounts(result.accounts); setRemoving(null)
        })
    }

    return <div className="mx-auto max-w-7xl px-4 pb-8 pt-5 text-white sm:px-6">
        <PanelTabHeader title="Client Connections" description="Connect client accounts to the systems used to deliver their services." actions={<button type="button" disabled={!unconnected.length} onClick={() => edit(null)} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">＋ Add connection</button>} />

        <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Agency Connection</h2><p className="mt-1 text-sm leading-6 text-neutral-400">The agency HighLevel account used to verify agency sub-accounts.</p></div><Status label={agency.connected ? "Connected" : "Not connected"} tone={agency.connected ? "green" : "grey"} /></div>
            {agency.connected ? <p className="mt-4 text-sm text-neutral-300">{agency.name ?? "HighLevel agency"}{agency.id ? ` · ${agency.id}` : ""}</p> : <p className="mt-4 text-sm text-neutral-400">Connect an agency account before linking an agency sub-account.</p>}
            <p className="mt-4 text-xs text-neutral-500">Only Admins can edit the agency connection in Settings.</p>
            {canManageAgency ? <Link href={`/${workspaceSlug}/settings#connections`} className="mt-3 inline-flex h-9 items-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500">Open Settings</Link> : null}
        </section>

        {error ? <p role="alert" className="mt-4 rounded-xl border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200">{error}</p> : null}
        {selectedRelationship ? <div className="mt-5 flex items-center justify-between gap-3 text-sm"><span className="text-neutral-400">Selected relationship</span><Link href={`/${workspaceSlug}/client-connections`} className="py-2 text-neutral-200 underline underline-offset-4">Show all clients</Link></div> : null}
        <List ariaLabel="Client accounts">
            {visibleAccounts.length ? visibleAccounts.map((account) => {
                const title = account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName
                const status = account.connected ? account.error ? { label: "Needs attention", tone: "red" as const } : { label: account.calendarId ? "Calendar ready" : "Connected", tone: "green" as const } : { label: "Getting ready", tone: "yellow" as const }
                return <ListItem key={account.relationshipId}><div tabIndex={0} aria-label={`${title} connection actions`} onContextMenu={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ account, anchor: event.currentTarget, point: { x: event.clientX - rect.left, y: event.clientY - rect.top } }) }} onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setMenu({ account, anchor: event.currentTarget }) } }}>
                    <ListPrimaryRow><ListTitle className="flex-1">{title}</ListTitle><Status label={status.label} tone={status.tone} /><button type="button" aria-label={`Actions for ${title}`} disabled={pending} onClick={(event) => setMenu({ account, anchor: event.currentTarget })} className="h-11 w-11 shrink-0 text-xl text-neutral-300">⋯</button></ListPrimaryRow>
                    <ListSecondaryRow><span className="min-w-0 truncate text-neutral-400">{account.connected ? `${account.accountType === "agency_subaccount" ? "Agency sub-account" : "Client account"}${account.locationName ? ` · ${account.locationName}` : ""}${account.calendarName ? ` · ${account.calendarName}` : ""}` : "Waiting for a HighLevel account to be linked"}</span><ListTrailing>{account.connected ? <button type="button" disabled={pending} onClick={() => refresh(account.relationshipId)} className="h-8 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 disabled:opacity-40">Refresh</button> : null}</ListTrailing></ListSecondaryRow>
                </div></ListItem>
            }) : <div className="p-6"><p className="font-semibold">{selectedRelationship ? "No available connection for this relationship." : "No Appointment Setting clients yet."}</p><p className="mt-2 text-sm text-neutral-400">{selectedRelationship ? "It may no longer be eligible or available to your account." : "Clients appear here as soon as Appointment Setting is added to their relationship."}</p></div>}
        </List>

        {open ? <CenteredDialog title={editing ? "Edit client connection" : "Add client connection"} busy={pending} onClose={closeEditor}><form onSubmit={submit}><fieldset disabled={pending} className="space-y-4">
            <label className="block text-sm text-neutral-300">Client<Selector name="relationshipId" required appearance="input" ariaLabel="Client account" value={relationshipId} onChange={(value) => { clearCalendars(); setRelationshipId(value) }} options={connectionChoices.map((account) => ({ value: account.relationshipId, label: account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName }))} /></label>
            <label className="block text-sm text-neutral-300">Account source<Selector name="accountType" required appearance="input" ariaLabel="Account source" value={accountType} onChange={(value) => setAccountType(value === "agency_subaccount" ? "agency_subaccount" : "client_account")} options={[{ value: "client_account", label: "Client account", description: "The client already owns this HighLevel account." }, { value: "agency_subaccount", label: "Agency sub-account", description: "Your team created this under the connected agency." }]} /></label>
            {accountType === "agency_subaccount" && !agency.connected ? <p role="alert" className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 p-3 text-sm text-yellow-200">Connect the agency HighLevel account in Settings first.</p> : null}
            <label className="block text-sm text-neutral-300">Location ID<input name="locationId" value={locationId} onChange={(event) => { clearCalendars(); setLocationId(event.target.value) }} required maxLength={80} autoComplete="off" className={field} /></label>
            <label className="block text-sm text-neutral-300">Private Integration Token<input name="privateToken" value={privateToken} onChange={(event) => { clearCalendars(); setPrivateToken(event.target.value) }} type="password" required={!editing?.connected} maxLength={4096} autoComplete="new-password" className={field} /><span className="mt-2 block text-xs leading-5 text-neutral-500">Use a location-level token with Locations, Contacts, Opportunities, Calendars and Calendar Events read access. Leave the token blank when editing to keep it. Existing credentials stay active until verification succeeds.</span></label>
            {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
            <button type="button" disabled={pending || loadingCalendars || !locationId || (!privateToken && !editing?.connected)} onClick={() => void loadCalendars()} className="min-h-11 px-3 text-sm underline underline-offset-4 disabled:opacity-40">{loadingCalendars ? "Loading calendars…" : "Load calendars"}</button>
            {calendars ? calendars.length ? <label className="block text-sm text-neutral-300">Client portal calendar<Selector name="calendarId" required appearance="input" ariaLabel="Client portal calendar" value={calendarId} onChange={setCalendarId} options={calendars.map(item => ({ value: item.id, label: item.name }))} /></label> : <p role="status" className="text-sm text-neutral-400">No published calendars were found for this location.</p> : null}
            <button type="submit" disabled={pending || !calendars || !calendarId || !relationshipId || (accountType === "agency_subaccount" && !agency.connected)} className="h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Verifying…" : editing ? "Save connection" : "Connect account"}</button>
        </fieldset></form></CenteredDialog> : null}
        {menu ? <AnchoredPopup anchor={menu.anchor} anchorPoint={menu.point} role="menu" onDismiss={() => setMenu(null)} className="w-48 rounded-xl border border-neutral-700 bg-neutral-900 p-1 text-white shadow-xl">
            <button role="menuitem" disabled={pending} type="button" onClick={() => edit(menu.account)} className="min-h-11 w-full rounded-lg px-3 text-left hover:bg-neutral-800">{menu.account.connected ? "Edit connection" : "Add connection"}</button>
            {menu.account.connected ? <button role="menuitem" disabled={pending} type="button" onClick={() => { setRemoving(menu.account); setMenu(null); setError(null) }} className="min-h-11 w-full rounded-lg px-3 text-left text-red-300 hover:bg-neutral-800">Remove connection</button> : null}
        </AnchoredPopup> : null}
        {removing ? <CenteredDialog title="Remove client connection?" busy={pending} onClose={() => setRemoving(null)}>
            <p className="text-sm leading-6 text-neutral-300">Unlink {removing.locationName ?? removing.clientName} from BE? Its calendar and CRM results will stop appearing in the client portal. GHL contacts, calendars and appointments will remain unchanged.</p>
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={pending} onClick={() => setRemoving(null)} className="min-h-11 px-3">Cancel</button><button type="button" disabled={pending} onClick={remove} className="min-h-11 rounded-lg bg-red-700 px-4 text-white">{pending ? "Removing…" : "Remove connection"}</button></div>
        </CenteredDialog> : null}
    </div>
}
