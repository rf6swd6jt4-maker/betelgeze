import type { ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { panelTabClass, panelTabStripClass } from "@/components/panel/PanelTabStrip"
import { RoundPill, Status } from "@/components/ui"
import { clientInitials } from "@/lib/client-rail"
import type { CampaignTagTone } from "@/lib/campaigns/model"

const statusTone = { live: "green", paused: "yellow", draft: "grey" } as const
const statusLabel = { live: "Live", paused: "Paused", draft: "Draft" } as const

/**
 * The head of a campaign's page, shaped like a client's page header: its mark and name, one quiet line (status, its
 * sources' tags, how many leads are not booked), its action, and the section tabs.
 */
export function CampaignPageHeader({ name, status, tags, notBooked, tabs, active, actions }: {
    name: string; status: string; tags: { tag: string; tone: CampaignTagTone }[]; notBooked: number
    tabs: { key: string; label: string; href: string; count?: number }[]; active: string; actions?: ReactNode
}) {
    const key = status as keyof typeof statusTone
    return <header data-campaign-page-header data-workspace-record-title={name} className="pt-5">
        {/* Phone: the mark sits at the top, tags take their own line and the actions their own row. */}
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-[13px] font-semibold text-neutral-200">{clientInitials(name)}</span>
                <div className="min-w-0 flex-1">
                    <h1 className="break-words text-xl font-semibold tracking-tight text-white sm:truncate">{name}</h1>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-neutral-400">
                        <Status label={statusLabel[key] ?? status} tone={statusTone[key] ?? "grey"} />
                        <span className="tabular-nums sm:order-last">{notBooked} not booked</span>
                        {tags.length ? <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">{tags.map(tag => <RoundPill key={tag.tag} tone={tag.tone}>{tag.tag}</RoundPill>)}</span> : <span>No sources yet</span>}
                    </div>
                </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <nav aria-label={`${name} sections`} className={`${panelTabStripClass} max-sm:-mx-4 max-sm:gap-3.5 max-sm:px-4`}>
            {tabs.map(tab => <Link key={tab.key} href={tab.href} prefetch={false} aria-current={tab.key === active ? "page" : undefined} className={panelTabClass(tab.key === active)}>
                {tab.label}{tab.count !== undefined ? <span className="ml-1.5 tabular-nums text-neutral-500">{tab.count}</span> : null}
            </Link>)}
        </nav>
    </header>
}
