"use client"

import { UnreadMessageCount } from "@/components/communications/UnreadMessageCount"
import type { CommunicationsMode } from "@/lib/communications/mode-resource"

const LABELS: Record<CommunicationsMode, string> = { clients: "Clients", team: "Team", leads: "Leads" }
const UNREAD_LABELS: Record<CommunicationsMode, string> = { clients: "unread Client messages", team: "unread Team messages", leads: "unread lead texts" }

/**
 * The Comms tabs: Clients, Team and, for people with Campaigns, Leads (docs/comms-leads.md). The open tab has no
 * count; the others show their unread count, or a loading mark while a device-mode count is unknown.
 */
export function CommunicationsModeTabs({ mode, onSelect, counts, leads, deviceMode }: {
    mode: CommunicationsMode
    onSelect: (mode: CommunicationsMode) => void
    counts: Partial<Record<CommunicationsMode, number | undefined>>
    leads: boolean
    deviceMode: boolean
}) {
    const modes: CommunicationsMode[] = leads ? ["clients", "team", "leads"] : ["clients", "team"]
    return <div role="tablist" aria-label="Communication conversations" className="flex items-center gap-1">
        {modes.map(item => item === mode
            ? <button key={item} type="button" role="tab" aria-selected="true" className="inline-flex h-8 items-center rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white">{LABELS[item]}</button>
            : <button key={item} type="button" role="tab" aria-selected="false" onClick={() => onSelect(item)} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white">{LABELS[item]}<UnreadMessageCount count={counts[item]} loading={deviceMode && counts[item] === undefined} label={UNREAD_LABELS[item]} /></button>)}
    </div>
}
