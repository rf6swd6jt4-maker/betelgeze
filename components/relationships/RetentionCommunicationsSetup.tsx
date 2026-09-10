"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Status } from "@/components/ui"
import { requestRetentionMessagingConfirmation } from "@/app/[workspaceSlug]/relationships/actions"

export function RetentionCommunicationsSetup({ workspaceSlug, relationshipId, pending, canRequest, provider, manualHandoff }: {
    workspaceSlug: string; relationshipId: string; pending: boolean; canRequest: boolean; provider: string; manualHandoff: boolean
}) {
    const [busy, startTransition] = useTransition()
    const [feedback, setFeedback] = useState<{ error?: string; notice?: string } | null>(null)
    const router = useRouter()
    return <section className="mb-5 space-y-3 border-b border-neutral-800 py-4" aria-label="Retention communications">
        <Status label={pending ? manualHandoff ? "Portal ready · Messaging not confirmed" : "Waiting for messaging confirmation" : "Messaging confirmed"} tone={pending ? "yellow" : "green"} />
        <p className="text-sm text-neutral-400">{manualHandoff ? <>The seller’s private portal handoff is in <Link href={`/${workspaceSlug}/communications?mode=team`} className="text-white underline">Comms → Team → BE</Link>. {pending ? "Client messages stay in the portal until their messaging channel is confirmed." : "The client can keep using the same portal link."}</> : pending ? "The portal link will be sent automatically after the client confirms. If the request was not sent, you can retry below." : "The portal link is queued for messaging delivery. Check Comms for its delivery status."}</p>
        {pending && canRequest ? <button type="button" disabled={busy} onClick={() => startTransition(async () => {
            setFeedback(null)
            const result = await requestRetentionMessagingConfirmation(workspaceSlug, relationshipId)
            setFeedback(result)
            if (result.ok) router.refresh()
        })} className="min-h-10 rounded-lg border border-neutral-700 px-3 text-sm hover:border-neutral-500 disabled:opacity-50">{busy ? "Requesting…" : `Request ${provider === "twilio_sms" ? "SMS" : "WhatsApp"} confirmation`}</button> : null}
        {feedback ? <p role={feedback.error ? "alert" : "status"} className={`text-sm ${feedback.error ? "text-red-300" : "text-neutral-300"}`}>{feedback.error ?? feedback.notice}</p> : null}
    </section>
}
