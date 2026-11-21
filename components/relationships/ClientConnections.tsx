"use client"

import { ClientConnectionsWorkspace } from "@/components/client-connections/ClientConnectionsWorkspace"
import type { ClientConnectionAccount } from "@/lib/client-connections"
import { createSectionRead } from "@/lib/client-section-read"
import { SectionHeading } from "@/components/detail"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { useClientSection } from "./useClientSection"

type Connections = {
    userId: string; relationshipId: string; accounts: ClientConnectionAccount[]
    agency: { connected: boolean; name: string | null; id: string | null }; canManageAgency: boolean
}
type Target = { workspaceSlug: string; relationshipId: string; userId: string }

const connectionsRead = createSectionRead<Connections>((_response, body) => (body as { error?: string } | null)?.error ?? "Connections could not be loaded.")
const keyOf = ({ workspaceSlug, relationshipId, userId }: Target) => `${userId}:${workspaceSlug}:${relationshipId}`
const urlOf = ({ workspaceSlug, relationshipId }: Target) => `/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/connections`

/** Started when the person points at the Connections tab, so the section is usually there by the time it opens. */
export function warmClientConnections(target: Target) { void connectionsRead.read(keyOf(target), urlOf(target), target.userId) }

/**
 * The Connections section of a client's page: the existing connections workspace, narrowed to this client, fed by one
 * read the first time the section is opened. It stays mounted afterwards, so returning to it is instant.
 */
export function ClientConnections(target: Target) {
    const { data, error, reload } = useClientSection(connectionsRead, keyOf(target), urlOf(target), target.userId, true)
    // A different account's answer is never shown.
    const current = data && data.userId === target.userId && data.relationshipId === target.relationshipId ? data : null
    if (!current) return <section aria-label="Connections" aria-busy={!error}>
        <SectionHeading>Connected accounts</SectionHeading>
        {error ? <p role="alert" className="py-2 text-sm text-red-200">{error} <button type="button" className="min-h-11 underline" onClick={reload}>Retry</button></p>
            : <div className="-mx-2 divide-y divide-card-border border-y border-card-border">{[40, 28, 34].map(width => <div key={width} aria-hidden="true" className="flex min-h-[4.0625rem] items-center px-2"><LoadingPulse className="h-4" style={{ width: `${width}%` }} /></div>)}</div>}
    </section>
    return <ClientConnectionsWorkspace embedded relationshipId={target.relationshipId} workspaceSlug={target.workspaceSlug} accounts={current.accounts} agency={current.agency} canManageAgency={current.canManageAgency} />
}
