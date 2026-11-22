"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, Selector } from "@/components/ui"
import { StageLabel } from "@/components/ui/RelationshipStage"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { CAMPAIGN_STAGES, campaignStageLabels, campaignStageMarks, type CampaignStage } from "@/lib/campaigns/model"
import { campaignCommand } from "@/app/[workspaceSlug]/campaigns/actions"

function useCommand(workspaceSlug: string) {
    const router = useRouter()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    async function run(action: "set_stage" | "booking_status", input: Record<string, unknown>) {
        setPending(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => campaignCommand(workspaceSlug, action, input))
            if (!result.ok) setError(result.error)
            else router.refresh()
        } catch {
            setError("Could not save. Please retry.")
        } finally {
            setPending(false)
        }
    }
    return { run, pending, error }
}

/** The lead's stage as an editable field. Only a payment or a booking can make Paid, not booked and Booked. */
export function LeadStageField({ workspaceSlug, leadId, stage }: { workspaceSlug: string; leadId: string; stage: CampaignStage }) {
    const { run, pending, error } = useCommand(workspaceSlug)
    return <div className="min-w-0">
        <Selector ariaLabel="Stage" value={stage} disabled={pending} onChange={next => { if (next !== stage) void run("set_stage", { lead_id: leadId, stage: next }) }}
            triggerContent={<StageLabel label={campaignStageLabels[stage]} tone={campaignStageMarks[stage]} />}
            options={CAMPAIGN_STAGES.map(value => ({ value, label: campaignStageLabels[value] }))} />
        {error ? <p role="alert" className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
}

/** Cancel, Showed and No-show for the lead's booked appointment. */
export function BookingActions({ workspaceSlug, bookingId, status }: { workspaceSlug: string; bookingId: string; status: string }) {
    const { run, pending, error } = useCommand(workspaceSlug)
    const [confirmCancel, setConfirmCancel] = useState(false)
    return <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
            {status === "booked" ? <>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run("booking_status", { booking_id: bookingId, status: "showed" })}>Showed</Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run("booking_status", { booking_id: bookingId, status: "no_show" })}>No-show</Button>
                {confirmCancel ? <>
                    <span className="text-sm text-neutral-400">Cancel this booking? The time opens for others.</span>
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => void run("booking_status", { booking_id: bookingId, status: "cancelled" })}>Cancel booking</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmCancel(false)}>Keep it</Button>
                </> : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmCancel(true)}>Cancel booking</Button>}
            </> : null}
        </div>
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
}
