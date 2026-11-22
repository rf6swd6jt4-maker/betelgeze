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

/** Mark sold: the lead becomes a client at the Sold stage (the client record itself comes with a later step). */
export function MarkSoldButton({ workspaceSlug, leadId, stage }: { workspaceSlug: string; leadId: string; stage: CampaignStage }) {
    const { run, pending, error } = useCommand(workspaceSlug)
    return <span className="flex items-center gap-2">
        {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
        <Button size="sm" variant={stage === "showed" ? "primary" : "secondary"} disabled={pending || stage === "sold"} title={stage === "sold" ? "Already sold" : undefined}
            onClick={() => void run("set_stage", { lead_id: leadId, stage: "sold" })}>{stage === "sold" ? "Sold" : "Mark sold"}</Button>
    </span>
}

/** The lead's own booking page link: open it to book a time with them on a call, or copy it to send. */
export function BookingLinkActions({ href }: { href: string }) {
    const [copied, setCopied] = useState(false)
    return <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" href={href} external>Book for them</Button>
        <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }, () => undefined) }}>{copied ? "Copied" : "Copy their booking link"}</Button>
    </div>
}
