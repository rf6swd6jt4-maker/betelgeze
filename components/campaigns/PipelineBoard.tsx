"use client"

import { useState, type DragEvent } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { RoundPill, SquarePill } from "@/components/ui"
import { StageLabel } from "@/components/ui/RelationshipStage"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { campaignStageMarks, type CampaignStage, type CampaignTagTone } from "@/lib/campaigns/model"
import { campaignCommand } from "@/app/[workspaceSlug]/campaigns/actions"

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

    return <>
        {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        <div className="-mx-2 mt-5 grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-4 overflow-x-auto px-2 pb-4">
            {columns.map(column => <section key={column.stage} aria-label={column.label} {...dropProps(column.stage)}
                className={`flex min-h-48 min-w-0 flex-col rounded-md p-1 transition-colors ${over === column.stage ? "bg-[var(--color-surface-hover)]" : ""}`}>
                <h2 className="flex items-center gap-2 px-1 pb-2 text-xs font-medium text-neutral-400">
                    <StageLabel label={column.label} tone={campaignStageMarks[column.stage]} className="!text-xs !text-neutral-300" />
                    <span className="ml-auto tabular-nums text-neutral-600">{column.cards.length}</span>
                </h2>
                {column.cards.map(card => <article key={card.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; setDragging({ id: card.id, from: column.stage }) }} onDragEnd={() => { setDragging(null); setOver(null) }}
                    className={`cursor-grab border-t border-card-border px-2 py-2 first-of-type:border-t-0 hover:bg-[var(--color-surface-hover)] ${pending === card.id ? "opacity-50" : ""} ${dragging?.id === card.id ? "opacity-40" : ""}`}>
                    <Link href={card.href} className="block truncate text-sm font-medium text-neutral-100 hover:underline">{card.name}</Link>
                    {card.company ? <p className="truncate text-xs text-neutral-500">{card.company}</p> : null}
                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                        {card.tag ? <RoundPill tone={card.tag.tone}>{card.tag.tag}</RoundPill> : null}
                        {card.test ? <SquarePill tone="yellow">Test</SquarePill> : null}
                        <span className="truncate tabular-nums">{card.line}</span>
                    </div>
                </article>)}
                {!column.cards.length ? <p className="px-2 py-2 text-xs text-neutral-600">None</p> : null}
            </section>)}
        </div>
    </>
}
