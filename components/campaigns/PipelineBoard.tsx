"use client"

import { useState, type DragEvent } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { RoundPill, SquarePill } from "@/components/ui"
import { StageLabel } from "@/components/ui/RelationshipStage"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { campaignStageMarks, type CampaignStage, type CampaignTagTone } from "@/lib/campaigns/model"
import { campaignCommand } from "@/app/[workspaceSlug]/campaigns/actions"
import { LeadChatButton } from "@/components/campaigns/LeadChatButton"

export type PipelineCard = { id: string; name: string; company: string | null; href: string; tag: { tag: string; tone: CampaignTagTone } | null; line: string; test: boolean }

/**
 * The pipeline: one column per stage. Dragging a card asks the server to move the lead; the database refuses moves
 * that only a booking or a payment can make, and the refusal is shown here.
 */
export function PipelineBoard({ workspaceSlug, columns }: { workspaceSlug: string; columns: { stage: CampaignStage; label: string; cards: PipelineCard[] }[] }) {
    const router = useRouter()
    const [dragging, setDragging] = useState<{ id: string; from: CampaignStage } | null>(null)
    const [over, setOver] = useState<CampaignStage | null>(null)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function move(leadId: string, from: CampaignStage, to: CampaignStage) {
        if (from === to) return
        setPending(leadId); setError(null)
        try {
            const result = await runWorkspaceMutation(() => campaignCommand(workspaceSlug, "set_stage", { lead_id: leadId, stage: to }))
            if (!result.ok) setError(result.error)
            else router.refresh()
        } catch {
            setError("Could not move the lead. Please retry.")
        } finally {
            setPending(null)
        }
    }

    const dropProps = (stage: CampaignStage) => ({
        onDragOver: (event: DragEvent) => { if (!dragging) return; event.preventDefault(); setOver(stage) },
        onDragLeave: () => setOver(current => current === stage ? null : current),
        onDrop: (event: DragEvent) => { event.preventDefault(); setOver(null); if (dragging) void move(dragging.id, dragging.from, stage); setDragging(null) },
    })

    const card = (column: { stage: CampaignStage }, item: PipelineCard, draggable: boolean) => <article key={item.id} draggable={draggable || undefined}
        onDragStart={draggable ? event => { event.dataTransfer.effectAllowed = "move"; setDragging({ id: item.id, from: column.stage }) } : undefined}
        onDragEnd={draggable ? () => { setDragging(null); setOver(null) } : undefined}
        className={`border-t border-card-border px-2 py-2.5 first-of-type:border-t-0 hover:bg-[var(--color-surface-hover)] ${draggable ? "cursor-grab" : ""} ${pending === item.id ? "opacity-50" : ""} ${dragging?.id === item.id ? "opacity-40" : ""}`}>
        <div className="flex min-w-0 items-center gap-2">
            <Link href={item.href} className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100 hover:underline">{item.name}</Link>
            <LeadChatButton workspaceSlug={workspaceSlug} leadId={item.id} variant="ghost" className="-my-1 sm:min-h-6! px-2!" />
        </div>
        {item.company ? <p className="truncate text-xs text-neutral-500">{item.company}</p> : null}
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
            {item.tag ? <RoundPill tone={item.tag.tone}>{item.tag.tag}</RoundPill> : null}
            {item.test ? <SquarePill tone="yellow">Test</SquarePill> : null}
            <span className="min-w-0 truncate tabular-nums">{item.line}</span>
        </div>
    </article>
    const total = columns.reduce((sum, column) => sum + column.cards.length, 0)

    return <>
        {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        {/* Phone: one list in stage order, only the stages that hold leads. A lead's stage changes on its page. */}
        <div className="mt-5 md:hidden">
            {total ? columns.filter(column => column.cards.length).map(column => <section key={column.stage} aria-label={column.label} className="mb-6">
                <h2 className="flex items-center gap-2 pb-1.5 text-xs font-medium text-neutral-400">
                    <StageLabel label={column.label} tone={campaignStageMarks[column.stage]} className="!text-[13px] !text-neutral-200" />
                    <span className="ml-auto tabular-nums text-neutral-500">{column.cards.length}</span>
                </h2>
                <div className="-mx-2 border-y border-card-border">{column.cards.map(item => card(column, item, false))}</div>
            </section>) : <p className="py-6 text-sm text-neutral-500">No leads yet. They appear here as soon as a source sends one.</p>}
        </div>
        {/* Wider screens: a column per stage; drag a card to move the lead. */}
        <div className="-mx-2 mt-5 hidden auto-cols-[minmax(10.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-2 pb-4 md:grid">
            {columns.map(column => <section key={column.stage} aria-label={column.label} {...dropProps(column.stage)}
                className={`flex min-h-56 min-w-0 flex-col rounded-md p-1 transition-colors ${over === column.stage ? "bg-[var(--color-surface-hover)]" : ""}`}>
                <h2 className="flex items-center gap-2 px-1 pb-2 text-xs font-medium text-neutral-400">
                    <StageLabel label={column.label} tone={campaignStageMarks[column.stage]} className="!text-xs !text-neutral-300" />
                    <span className="ml-auto tabular-nums text-neutral-600">{column.cards.length || ""}</span>
                </h2>
                {column.cards.map(item => card(column, item, true))}
            </section>)}
        </div>
    </>
}
