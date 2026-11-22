import type { ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { RoundPill, Status } from "@/components/ui"
import { NewFlowButtons } from "@/components/campaigns/NewFlowButtons"
import { flowSources, triggerText, type FlowSourceFacts } from "@/lib/campaigns/flows"
import type { FlowListItem } from "@/lib/campaigns/flows-server"
import type { CampaignTagTone } from "@/lib/campaigns/model"

type Source = FlowSourceFacts & { tone: string }

/** Who a flow is for: all sources, or the tags of the ones it is limited to. */
export function FlowSources({ item, sources }: { item: Pick<FlowListItem, "flow">; sources: Source[] }) {
    const applies = flowSources(item.flow, sources) as Source[]
    if (!applies.length) return <span className="text-neutral-600">No sources</span>
    if (item.flow.sourceIds === null && item.flow.trigger !== "hold") return <span>All sources</span>
    return <span className="flex flex-wrap items-center gap-1">{applies.map(source => <RoundPill key={source.id} tone={source.tone as CampaignTagTone}>{source.tag}</RoundPill>)}</span>
}

/**
 * The Text flows tab (docs/text-flows.md): the number the campaign texts from, the rules every flow follows, and the
 * campaign's flows compared down the columns.
 */
export function FlowsTab({ workspaceSlug, campaignId, base, items, sources, numberField }: {
    workspaceSlug: string; campaignId: string; base: string; items: FlowListItem[]; sources: Source[]; numberField: ReactNode
}) {
    return <div className="mt-5 flex flex-col gap-5">
        <section aria-label="Rules" className="flex flex-col gap-3 border-y border-card-border py-3 lg:flex-row lg:items-start lg:gap-8">
            <div className="min-w-0 lg:w-[26rem]">{numberField}</div>
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-400 lg:pt-2">
                <li>STOP opts a lead out of every flow</li>
                <li>Each lead is in a flow once at a time</li>
                <li>Texts go out in each flow&apos;s sending hours, in the lead&apos;s time zone</li>
            </ul>
        </section>
        <Table ariaLabel="Text flows" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
            <TableHead>
                <TableHeading>Flow</TableHeading>
                <TableHeading className="max-md:hidden">Starts when</TableHeading>
                <TableHeading className="max-lg:hidden">For</TableHeading>
                <TableHeading numeric className="max-sm:hidden">Texts</TableHeading>
                <TableHeading numeric className="max-sm:hidden">In it now</TableHeading>
                <TableHeading numeric className="max-md:hidden">Replied</TableHeading>
                <TableHeading>Status</TableHeading>
            </TableHead>
            <TableBody>
                {items.length ? items.map(item => <TableRow key={item.flow.id}>
                    <TableCell primary className="w-full max-w-0 max-sm:h-14 sm:w-[28%]">
                        <span className="flex min-w-0 flex-col">
                            <Link data-table-open href={`${base}/flows/${item.flow.id}`} prefetch={false} className="min-w-0 truncate text-sm hover:underline sm:text-[13px]">{item.flow.name}</Link>
                            {item.warnings ? <span className="text-xs font-normal text-amber-300">{item.warnings} thing{item.warnings > 1 ? "s" : ""} to fix</span>
                                : <span className="truncate text-xs font-normal text-neutral-500 md:hidden">{triggerText(item.flow)}</span>}
                        </span>
                    </TableCell>
                    <TableCell className="max-md:hidden">{triggerText(item.flow)}</TableCell>
                    <TableCell className="max-lg:hidden"><FlowSources item={item} sources={sources} /></TableCell>
                    <TableCell numeric className="max-sm:hidden">{item.texts}</TableCell>
                    <TableCell numeric className="max-sm:hidden">{item.active}</TableCell>
                    <TableCell numeric className="max-md:hidden">{item.replied === null ? "–" : `${item.replied}%`}</TableCell>
                    <TableCell><Status label={item.flow.enabled ? "On" : "Off"} tone={item.flow.enabled ? "green" : "grey"} /></TableCell>
                </TableRow>) : <TableEmpty columns={7}>No flows yet. Start with the four from the plan, or a blank one. Until a flow is on, nothing is texted automatically.</TableEmpty>}
            </TableBody>
        </Table>
        <NewFlowButtons workspaceSlug={workspaceSlug} campaignId={campaignId} base={base} starters={!items.length} />
    </div>
}
