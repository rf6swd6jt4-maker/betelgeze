"use client"

import { calendarChoiceLabel } from "@/lib/client-portal/ghl-calendar"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "@/components/workspace/WorkspaceNavigation"
import { useMemo, useState, useTransition, useRef, useEffect, type FormEvent } from "react"
import { saveClientAccount, removeClientAccount, refreshClientAccount } from "@/app/[workspaceSlug]/client-connections/actions"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListPrimaryAction } from "@/components/list/ListPrimaryAction"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { CenteredDialog, Selector, Status } from "@/components/ui"
import type { ClientConnectionAccount, ConnectionHistoryCursor } from "@/lib/client-connections"
import { AdvertisingConnectionRows } from "./AdvertisingConnectionRows"

const field = "mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-400"
const GhlAppConnectionDialog = dynamic(() => import("./GhlAppConnectionDialog").then(module => module.GhlAppConnectionDialog))
const MetaReportingDialog = dynamic(() => import("./MetaReportingDialog").then(module => module.MetaReportingDialog))

export function ClientConnectionsWorkspace({ workspaceSlug, accounts: initialAccounts, historyCursor = null, agency, canManageAgency }: {
    workspaceSlug: string
    accounts: ClientConnectionAccount[]
    historyCursor?: ConnectionHistoryCursor | null
    agency: { connected: boolean; name: string | null; id: string | null }
    canManageAgency: boolean
}) {
    const [accounts, setAccounts] = useState(initialAccounts)
    const [nextCursor, setNextCursor] = useState(historyCursor)
    const [loadedAccounts, setLoadedAccounts] = useState(initialAccounts)
    if (loadedAccounts !== initialAccounts) {
        setLoadedAccounts(initialAccounts)
        setAccounts(initialAccounts)
        setNextCursor(historyCursor)
    }
    const [editing, setEditing] = useState<ClientConnectionAccount | null>(null)
    const [metaReporting, setMetaReporting] = useState<Pick<ClientConnectionAccount, "relationshipId" | "clientName" | "businessName"> | null>(null)
    const [advertisingRefresh, setAdvertisingRefresh] = useState<{ relationshipId: string } | null>(null)
    const [removing, setRemoving] = useState<ClientConnectionAccount | null>(null)
    const [loadingHistory, setLoadingHistory] = useState(false)
    const historyRequest = useRef<AbortController | null>(null)
    useEffect(() => () => historyRequest.current?.abort(), [])
    const [locationId, setLocationId] = useState("")
    const [privateToken, setPrivateToken] = useState("")
    const [calendarId, setCalendarId] = useState("")
    const [calendars, setCalendars] = useState<{ id: string; name: string; isActive?: boolean }[] | null>(null)
    const [loadingCalendars, setLoadingCalendars] = useState(false)
    const calendarRequest = useRef<AbortController | null>(null)
    useEffect(() => () => calendarRequest.current?.abort(), [])
    const router = useRouter(), search = useSearchParams()
    const selectedRelationship = search.get("relationship")
    const returnedFromHighLevel = search.get("ghl")
    const [handledReturn, setHandledReturn] = useState<string | null>(null)
    const [appDialog, setAppDialog] = useState<{ account?: ClientConnectionAccount; choices?: ClientConnectionAccount[]; resume?: boolean } | null>(null)
    if (returnedFromHighLevel && handledReturn !== returnedFromHighLevel) {
        setHandledReturn(returnedFromHighLevel); setAppDialog({ resume: true })
    }
    const visibleAccounts = useMemo(() => selectedRelationship ? accounts.filter(account => account.relationshipId === selectedRelationship) : accounts, [accounts, selectedRelationship])
    const unconnected = useMemo(() => visibleAccounts.filter((account) => !account.connected && !account.historyId && !account.archived), [visibleAccounts])
    const [connectionChoices, setConnectionChoices] = useState<ClientConnectionAccount[]>([])
    const [open, setOpen] = useState(false)
    const [relationshipId, setRelationshipId] = useState("")
    const [accountType, setAccountType] = useState<"client_account" | "agency_subaccount">("client_account")
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function mergeAccounts(updated: ClientConnectionAccount[]) {
        // Exact-relationship responses replace live rows and merge immutable history by revision.
        setAccounts(current => {
            const ids = new Set(updated.filter(row => !row.historyId).map(row => row.relationshipId))
            const byKey = new Map(current.filter(row => row.historyId || !ids.has(row.relationshipId)).map(row => [row.historyId ?? row.relationshipId, row]))
            for (const row of updated) byKey.set(row.historyId ?? row.relationshipId, row)
            return [...byKey.values()]
        })
    }
    async function loadHistory() {
        if (!nextCursor || loadingHistory) return
        const controller = new AbortController(); historyRequest.current = controller
        const timeout = setTimeout(() => controller.abort(), 30_000)
        setLoadingHistory(true); setError(null)
        try {
            const query = new URLSearchParams(nextCursor)
            if (selectedRelationship) query.set("relationship", selectedRelationship)
            const response = await fetch(`/api/workspaces/${workspaceSlug}/client-connections/history?${query}`, { signal: controller.signal })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error)
            if (historyRequest.current !== controller || controller.signal.aborted) return
            mergeAccounts(result.history); setNextCursor(result.nextCursor)
        } catch { if (historyRequest.current === controller) setError("Connection history could not be loaded. Try again.") }
        finally { clearTimeout(timeout); if (historyRequest.current === controller) { setLoadingHistory(false); historyRequest.current = null } }
    }
    function clearCalendars() {
        calendarRequest.current?.abort(); calendarRequest.current = null
        setLoadingCalendars(false); setCalendars(null); setCalendarId("")
    }
    function closeEditor() { clearCalendars(); setPrivateToken(""); setOpen(false); setError(null) }
    function edit(account: ClientConnectionAccount | null) {
        clearCalendars(); setEditing(account); setError(account?.error ? "This connection needs attention. Load calendars to verify its access." : null); setPrivateToken("")
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
            const result = await saveClientAccount(workspaceSlug, { relationshipId, accountType, locationId, privateToken, calendarId, expectedRevision: editing?.revision ?? null }, true)
            if (!result.ok) { setError(result.error); return }
            mergeAccounts(result.accounts ?? []); closeEditor()
        })
    }
    function refresh(relationshipId: string) {
        setError(null)
        startTransition(async () => {
            const result = await refreshClientAccount(workspaceSlug, relationshipId, true)
            if (!result.ok) { setError(result.error); return }
            if (result.accounts) mergeAccounts(result.accounts ?? [])
        })
    }
    function remove() {
        if (!removing?.revision) return
        setError(null)
        startTransition(async () => {
            const result = await removeClientAccount(workspaceSlug, removing.relationshipId, removing.revision!, true)
            if (!result.ok) { setError(result.error); return }
            setAccounts(current => current.filter(row => row.historyId || row.relationshipId !== removing.relationshipId)); mergeAccounts([...(result.accounts ?? []), ...(result.retired ?? [])]); setRemoving(null); closeEditor()
        })
    }

    return <div className="mx-auto max-w-7xl px-4 pb-8 pt-5 text-white sm:px-6">
        <PanelTabHeader title="Client Connections" description="HighLevel, Google Ads, Meta Ads access and Windsor reporting connections." actions={<button type="button" disabled={!unconnected.length} onClick={() => setAppDialog({ choices: unconnected })} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">Connect HighLevel</button>} />

        <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Agency connection</h2><p className="mt-1 text-sm leading-6 text-neutral-400">Used to verify agency sub-accounts connected with a private token. App connections are authorised directly in HighLevel.</p></div><Status label={agency.connected ? "Connected" : "Not connected"} tone={agency.connected ? "green" : "grey"} /></div>
            {agency.connected ? <p className="mt-4 text-sm text-neutral-300">{agency.name ?? "HighLevel agency"}{agency.id ? ` · ${agency.id}` : ""}</p> : <p className="mt-4 text-sm text-neutral-400">The HighLevel app can connect your own agency’s sub-accounts without a separate agency-token setup here.</p>}
            <p className="mt-4 text-xs text-neutral-500">Only Admins can edit the agency connection in Settings.</p>
            {canManageAgency ? <Link href={`/${workspaceSlug}/settings#connections`} className="mt-3 inline-flex h-9 items-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500">Open Settings</Link> : null}
        </section>

        {error ? <p role="alert" className="mt-4 rounded-xl border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200">{error}</p> : null}
        {selectedRelationship ? <div className="mt-5 flex items-center justify-between gap-3 text-sm"><span className="text-neutral-400">Selected relationship</span><Link href={`/${workspaceSlug}/client-connections`} className="py-2 text-neutral-200 underline underline-offset-4">Show all clients</Link></div> : null}
        <List ariaLabel="Client connections">
            {visibleAccounts.length ? visibleAccounts.map((account) => {
                const title = account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName
                const status = account.historyId ? { label: "Retired", tone: "red" as const } : account.connected ? { label: "Active", tone: account.error ? "yellow" as const : "green" as const } : { label: "Not configured", tone: "yellow" as const }
                return <ListItem key={account.historyId ?? account.relationshipId}>
                    <ListPrimaryRow><ListTitle className="flex-1">{title}</ListTitle><Status label={status.label} tone={status.tone} /></ListPrimaryRow>
                    <ListSecondaryRow>
                        <span className="min-w-0 truncate text-neutral-400">HighLevel · {account.locationName ?? "No account linked"}{account.archived ? " · Archived relationship" : ""}{account.retiredAt ? ` · Retired ${new Date(account.retiredAt).toLocaleDateString()}` : ""}</span>
                        <ListTrailing>
                            {!account.historyId && !account.archived ? <span className="-my-2 flex"><ListPrimaryAction label="Meta Ads" accessibleLabel={`Manage Meta Ads reporting for ${title}`} onClick={() => setMetaReporting(account)} /></span> : null}
                            <button type="button" aria-label={`Actions for ${title}${account.historyId ? " retired connection" : ""}`} disabled={pending} onClick={() => account.historyId || account.archived ? edit(account) : setAppDialog({ account })} className="-my-3 flex h-11 w-11 shrink-0 items-center justify-center text-neutral-300 hover:text-white disabled:opacity-40"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg></button>
                        </ListTrailing>
                    </ListSecondaryRow>
                </ListItem>
            }) : <div className="p-6"><p className="font-semibold">No available HighLevel connections.</p><p className="mt-2 text-sm text-neutral-400">{selectedRelationship ? "It may no longer be eligible or available to your account." : "Clients in onboarding or retention can connect HighLevel without purchasing Appointment Setting."}</p></div>}
            <AdvertisingConnectionRows key={`${workspaceSlug}:${selectedRelationship ?? "all"}`} workspaceSlug={workspaceSlug} relationshipId={selectedRelationship ?? undefined} refresh={advertisingRefresh} onManageWindsor={setMetaReporting} />
        </List>

        {metaReporting ? <MetaReportingDialog key={`${workspaceSlug}:${metaReporting.relationshipId}`} workspaceSlug={workspaceSlug} relationshipId={metaReporting.relationshipId} clientName={metaReporting.businessName ? `${metaReporting.clientName} – ${metaReporting.businessName}` : metaReporting.clientName} onClose={() => setMetaReporting(null)} onSaved={() => setAdvertisingRefresh({ relationshipId: metaReporting.relationshipId })} /> : null}

        {appDialog ? <GhlAppConnectionDialog key={appDialog.resume ? "resume" : appDialog.account?.relationshipId ?? "new"} workspaceSlug={workspaceSlug} accounts={accounts.filter(account => !account.historyId && !account.archived)} initialAccount={appDialog.account} initialChoices={appDialog.choices} resume={appDialog.resume} onClose={() => setAppDialog(null)} onManual={account => { setAppDialog(null); edit(account) }} onSaved={() => router.refresh()} /> : null}
        {nextCursor ? <button type="button" disabled={loadingHistory} onClick={() => void loadHistory()} className="mt-4 min-h-11 px-3 text-sm underline underline-offset-4 disabled:opacity-40">{loadingHistory ? "Loading history…" : "Load older connections"}</button> : null}
        {open && editing?.historyId ? <CenteredDialog title="Retired connection" onClose={closeEditor}><p className="text-sm leading-6 text-neutral-300">{editing.locationName ?? editing.locationId} · {editing.clientName}</p><p className="mt-3 text-sm text-neutral-400">Retired {editing.retiredAt ? new Date(editing.retiredAt).toLocaleString() : ""}. This connection no longer reserves the location or provides portal access.</p><p className="mt-3 text-sm text-neutral-400">Calendar: {editing.calendarName ?? "Not selected"}</p></CenteredDialog> : null}
        {open && !editing?.historyId ? <CenteredDialog title="Manual connection" busy={pending} onClose={closeEditor}><form onSubmit={submit}>{editing?.archived ? <p className="mb-4 text-sm text-neutral-400">This relationship is archived. Retire its connection to release the location for another relationship.</p> : null}<fieldset disabled={pending || editing?.archived} className="space-y-4">
            <label className="block text-sm text-neutral-300">Client<Selector name="relationshipId" required appearance="input" ariaLabel="Client account" value={relationshipId} onChange={(value) => { clearCalendars(); setRelationshipId(value) }} options={connectionChoices.map((account) => ({ value: account.relationshipId, label: account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName }))} /></label>
            <label className="block text-sm text-neutral-300">Account source<Selector name="accountType" required appearance="input" ariaLabel="Account source" value={accountType} onChange={(value) => setAccountType(value === "agency_subaccount" ? "agency_subaccount" : "client_account")} options={[{ value: "client_account", label: "Client account", description: "The client already owns this HighLevel account." }, { value: "agency_subaccount", label: "Agency sub-account", description: "Your team created this under the connected agency." }]} /></label>
            {accountType === "agency_subaccount" && !agency.connected ? <p role="alert" className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 p-3 text-sm text-yellow-200">Connect the agency HighLevel account in Settings first.</p> : null}
            <label className="block text-sm text-neutral-300">Location ID<input name="locationId" readOnly={editing?.connected} value={locationId} onChange={(event) => { clearCalendars(); setLocationId(event.target.value) }} required maxLength={80} autoComplete="off" className={field} /></label>
            <label className="block text-sm text-neutral-300">Private Integration Token<input name="privateToken" value={privateToken} onChange={(event) => { clearCalendars(); setPrivateToken(event.target.value) }} type="password" required={!editing?.connected} maxLength={4096} autoComplete="new-password" className={field} /><span className="mt-2 block text-xs leading-5 text-neutral-500">Use a location-level token with Locations, Contacts, Opportunities, Calendars and Calendar Events read access. Leave the token blank when editing to keep it. Existing credentials stay active until verification succeeds. Retire this connection before changing its location.</span></label>
            {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
            <button type="button" disabled={pending || loadingCalendars || !locationId || (!privateToken && !editing?.connected)} onClick={() => void loadCalendars()} className="min-h-11 px-3 text-sm underline underline-offset-4 disabled:opacity-40">{loadingCalendars ? "Loading calendars…" : "Load calendars"}</button>
            {calendars ? calendars.length ? <label className="block text-sm text-neutral-300">Client portal calendar<Selector name="calendarId" required appearance="input" ariaLabel="Client portal calendar" value={calendarId} onChange={setCalendarId} options={calendars.map(item => ({ value: item.id, label: calendarChoiceLabel(item, calendars) }))} /></label> : <p role="status" className="text-sm text-neutral-400">No calendars were found for this location.</p> : null}
            <button type="submit" disabled={pending || !calendars || !calendarId || !relationshipId || (accountType === "agency_subaccount" && !agency.connected)} className="h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Verifying…" : editing ? "Save connection" : "Connect account"}</button>
        </fieldset>{editing?.connected ? <div className="mt-5 flex items-center justify-between border-t border-neutral-800 pt-3">{!editing.archived ? <button type="button" disabled={pending} onClick={() => refresh(editing.relationshipId)} className="min-h-11 px-3 text-sm">Refresh connection</button> : <span />}<button type="button" disabled={pending} onClick={() => { setRemoving(editing); setError(null) }} className="min-h-11 px-3 text-sm text-red-300">Retire connection</button></div> : null}</form></CenteredDialog> : null}
        {removing ? <CenteredDialog title="Retire client connection?" busy={pending} onClose={() => setRemoving(null)}>
            <p className="text-sm leading-6 text-neutral-300">Retire {removing.locationName ?? removing.clientName}? Its calendar and CRM results will stop appearing in the client portal, and the location will be available for a new connection. The stored BE credential will be deleted. Connection history and GHL contacts, calendars and appointments will remain.</p>
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={pending} onClick={() => setRemoving(null)} className="min-h-11 px-3">Cancel</button><button type="button" disabled={pending} onClick={remove} className="min-h-11 rounded-lg bg-red-700 px-4 text-white">{pending ? "Retiring…" : "Confirm retirement"}</button></div>
        </CenteredDialog> : null}
    </div>
}
