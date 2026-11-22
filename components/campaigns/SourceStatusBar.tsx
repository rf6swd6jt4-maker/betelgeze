"use client"

import { useState, type ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, Status } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { campaignCommand, sendTestLead } from "@/app/[workspaceSlug]/campaigns/actions"
import { originOf, type CampaignSourceStatus } from "@/lib/campaigns/model"

function Check({ done, children }: { done: boolean; children: ReactNode }) {
    return <li className={`flex items-center gap-2.5 text-sm ${done ? "text-neutral-200" : "text-neutral-500"}`}>
        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${done ? "border-emerald-400 bg-emerald-400 text-neutral-950" : "border-neutral-600"}`}>{done ? "✓" : ""}</span>
        <span>{children}</span><span className="sr-only">{done ? "done" : "to do"}</span>
    </li>
}

/**
 * Where a source stands and what moves it on: in Testing, the steps before it goes live and a test lead that runs the
 * real intake; once Live, switching it off. Status changes only here.
 */
export function SourceStatusBar({ workspaceSlug, campaignId, sourceId, status, pageUrl, books, hasLead, appOrigin }: {
    workspaceSlug: string; campaignId: string; sourceId: string; status: CampaignSourceStatus; pageUrl: string | null; books: boolean; hasLead: boolean; appOrigin: string
}) {
    const router = useRouter()
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState<{ bookingPath: string | null } | null>(null)
    const pageReady = Boolean(originOf(pageUrl ?? ""))
    const leadReady = hasLead || Boolean(sent)

    async function setStatus(next: CampaignSourceStatus) {
        setPending(next); setError(null)
        try {
            const result = await runWorkspaceMutation(() => campaignCommand(workspaceSlug, "update_source", { source_id: sourceId, fields: { status: next } }))
            if (!result.ok) setError(result.error)
            else router.refresh()
        } catch { setError("Could not save. Please retry.") } finally { setPending(null) }
    }
    async function test() {
        setPending("test"); setError(null)
        try {
            const result = await runWorkspaceMutation(() => sendTestLead(workspaceSlug, sourceId))
            if (!result.ok) setError(result.error)
            else { setSent({ bookingPath: result.bookingPath }); router.refresh() }
        } catch { setError("Could not send the test lead. Please retry.") } finally { setPending(null) }
    }

    return <section aria-label="Status" className="mt-5">
        {/* Status and its actions share the first line; the explanation runs full width beneath on a phone. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Status label={status === "live" ? "Live" : status === "off" ? "Off" : "Testing"} tone={status === "live" ? "green" : status === "off" ? "grey" : "yellow"} />
            <span className="order-last w-full text-sm text-neutral-400 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">{status === "live" ? "Leads arrive in Not booked, tagged with this source." : status === "off" ? "Its address answers that intake is closed, and its booking page is off." : "Leads are accepted and marked Test, so you can try the whole flow."}</span>
            <span className="ml-auto flex flex-wrap items-center gap-2 sm:ml-0">{status === "testing" ? <>
                <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => void test()}>{pending === "test" ? "Sending…" : "Send a test lead"}</Button>
                <Button size="sm" disabled={pending !== null || !pageReady || !leadReady} title={!pageReady || !leadReady ? "Finish the steps below first" : undefined} onClick={() => void setStatus("live")}>Go live</Button>
            </> : status === "live" ? <>
                <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => void setStatus("testing")}>Back to Testing</Button>
                <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => void setStatus("off")}>Switch off</Button>
            </> : <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => void setStatus("testing")}>Turn back on</Button>}</span>
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
        {status === "testing" ? <div className="mt-4">
            <p className="text-xs font-medium text-neutral-500">Before it goes live</p>
            <ul className="mt-2 flex flex-col gap-2">
                <Check done={pageReady}>Add the landing page address, below</Check>
                <Check done={leadReady}>A lead arrives from the form, or send a test lead</Check>
            </ul>
        </div> : null}
        {sent ? <p role="status" className="mt-4 text-sm text-neutral-300">
            Test lead sent.{" "}
            {sent.bookingPath && books ? <a href={`${appOrigin}${sent.bookingPath}`} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">Open its booking page</a> : null}
            {sent.bookingPath && books ? " · " : null}
            <Link href={`/${workspaceSlug}/campaigns/${campaignId}`} className="text-[var(--color-accent)] hover:underline">See it in the pipeline</Link>
        </p> : null}
    </section>
}
