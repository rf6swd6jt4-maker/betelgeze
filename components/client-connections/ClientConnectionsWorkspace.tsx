"use client"

import Link from "next/link"
import { useMemo, useState, useTransition, type FormEvent } from "react"
import { connectClientAccount, refreshClientAccount } from "@/app/[workspaceSlug]/client-connections/actions"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { CenteredDialog, Selector, Status } from "@/components/ui"
import type { ClientConnectionAccount } from "@/lib/client-connections"

const field = "mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-400"

export function ClientConnectionsWorkspace({ workspaceSlug, accounts, agency, canManageAgency }: {
    workspaceSlug: string
    accounts: ClientConnectionAccount[]
    agency: { connected: boolean; name: string | null; id: string | null }
    canManageAgency: boolean
}) {
    const unconnected = useMemo(() => accounts.filter((account) => !account.connected), [accounts])
    const [open, setOpen] = useState(false)
    const [relationshipId, setRelationshipId] = useState(unconnected[0]?.relationshipId ?? "")
    const [accountType, setAccountType] = useState<"client_account" | "agency_subaccount">("client_account")
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setError(null)
        const data = new FormData(event.currentTarget)
        startTransition(async () => {
            const result = await connectClientAccount(workspaceSlug, { relationshipId, accountType, locationId: String(data.get("locationId") ?? ""), privateToken: String(data.get("privateToken") ?? "") })
            if (!result.ok) { setError(result.error); return }
            setOpen(false); window.location.reload()
        })
    }

    function refresh(relationshipId: string) {
        setError(null)
        startTransition(async () => {
            const result = await refreshClientAccount(workspaceSlug, relationshipId)
            if (!result.ok) { setError(result.error); return }
            window.location.reload()
        })
    }

    return <div className="mx-auto max-w-7xl px-4 pb-8 pt-5 text-white sm:px-6">
        <PanelTabHeader title="Client Connections" description="Connect client accounts to the systems used to deliver their services." actions={<button type="button" disabled={!unconnected.length} onClick={() => { setError(null); setOpen(true) }} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">＋ Add connection</button>} />

        <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Agency Connection</h2><p className="mt-1 text-sm leading-6 text-neutral-400">The agency HighLevel account used to verify agency sub-accounts.</p></div><Status label={agency.connected ? "Connected" : "Not connected"} tone={agency.connected ? "green" : "grey"} /></div>
            {agency.connected ? <p className="mt-4 text-sm text-neutral-300">{agency.name ?? "HighLevel agency"}{agency.id ? ` · ${agency.id}` : ""}</p> : <p className="mt-4 text-sm text-neutral-400">Connect an agency account before linking an agency sub-account.</p>}
            <p className="mt-4 text-xs text-neutral-500">Only Admins can edit the agency connection in Settings.</p>
            {canManageAgency ? <Link href={`/${workspaceSlug}/settings#connections`} className="mt-3 inline-flex h-9 items-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500">Open Settings</Link> : null}
        </section>

        {error ? <p role="alert" className="mt-4 rounded-xl border border-red-900/70 bg-red-950/20 p-3 text-sm text-red-200">{error}</p> : null}
        <List ariaLabel="Client accounts">
            {accounts.length ? accounts.map((account) => {
                const title = account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName
                const status = account.connected ? account.error ? { label: "Needs attention", tone: "red" as const } : { label: "Ready", tone: "green" as const } : { label: "Getting ready", tone: "yellow" as const }
                return <ListItem key={account.relationshipId}>
                    <ListPrimaryRow><ListTitle className="flex-1">{title}</ListTitle><Status label={status.label} tone={status.tone} /></ListPrimaryRow>
                    <ListSecondaryRow><span className="min-w-0 truncate text-neutral-400">{account.connected ? `${account.accountType === "agency_subaccount" ? "Agency sub-account" : "Client account"}${account.locationName ? ` · ${account.locationName}` : ""}` : "Waiting for a HighLevel account to be linked"}</span><ListTrailing>{account.connected ? <button type="button" disabled={pending} onClick={() => refresh(account.relationshipId)} className="h-8 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 disabled:opacity-40">Refresh</button> : null}</ListTrailing></ListSecondaryRow>
                </ListItem>
            }) : <div className="p-6"><p className="font-semibold">No Appointment Setting clients yet.</p><p className="mt-2 text-sm text-neutral-400">Clients appear here as soon as Appointment Setting is added to their relationship.</p></div>}
        </List>

        {open ? <CenteredDialog title="Add client connection" busy={pending} onClose={() => setOpen(false)}><form onSubmit={submit} className="space-y-4">
            <label className="block text-sm text-neutral-300">Client<Selector name="relationshipId" required appearance="input" ariaLabel="Client account" value={relationshipId} onChange={setRelationshipId} options={unconnected.map((account) => ({ value: account.relationshipId, label: account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName }))} /></label>
            <label className="block text-sm text-neutral-300">Account source<Selector name="accountType" required appearance="input" ariaLabel="Account source" value={accountType} onChange={(value) => setAccountType(value === "agency_subaccount" ? "agency_subaccount" : "client_account")} options={[{ value: "client_account", label: "Client account", description: "The client already owns this HighLevel account." }, { value: "agency_subaccount", label: "Agency sub-account", description: "Your team created this under the connected agency." }]} /></label>
            {accountType === "agency_subaccount" && !agency.connected ? <p role="alert" className="rounded-lg border border-yellow-800/60 bg-yellow-950/20 p-3 text-sm text-yellow-200">Connect the agency HighLevel account in Settings first.</p> : null}
            <label className="block text-sm text-neutral-300">Location ID<input name="locationId" required maxLength={80} autoComplete="off" className={field} /></label>
            <label className="block text-sm text-neutral-300">Private Integration Token<input name="privateToken" type="password" required maxLength={4096} autoComplete="new-password" className={field} /><span className="mt-2 block text-xs leading-5 text-neutral-500">Use a location-level token with Contacts, Opportunities, Locations, Calendar Events and Users read access. Existing credentials remain active until this verification succeeds.</span></label>
            {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
            <button type="submit" disabled={pending || !relationshipId || (accountType === "agency_subaccount" && !agency.connected)} className="h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Verifying…" : "Connect account"}</button>
        </form></CenteredDialog> : null}
    </div>
}
