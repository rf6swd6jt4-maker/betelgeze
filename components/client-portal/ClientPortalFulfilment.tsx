import { PortalIcon, PortalSection } from "@/components/client-portal/ClientPortalUI"
import { Status } from "@/components/ui"
import { progressLabels, type ClientPortalOverview, type PortalProgressStatus } from "@/lib/client-portal/overview"

const tones: Record<PortalProgressStatus, "grey" | "yellow" | "green"> = {
    preparing: "grey",
    in_progress: "yellow",
    in_review: "yellow",
    live: "green",
    complete: "green",
}

export function ClientPortalFulfilment({ overview }: { overview: ClientPortalOverview }) {
    const open = overview.actions.filter((action) => action.status === "open")
    const completed = overview.actions.filter((action) => action.status === "completed")
    return <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain pb-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6">
        <PortalSection id="required-actions" title="Required actions" description="Anything your team needs from you will appear here." icon="checklist">
            <div className="mt-5 min-h-0 overflow-y-auto">
                {!open.length && !completed.length ? <div className="rounded-2xl bg-black/[0.025] px-4 py-8 text-center"><PortalIcon name="checklist" className="mx-auto h-7 w-7 text-[var(--onboarding-muted,#475569)]" /><p className="mt-3 text-sm font-semibold">You’re all caught up</p><p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">New actions from your team will appear here.</p></div> : null}
                <ul className="space-y-2">
                    {open.map((action) => <li key={action.id} className="flex items-start gap-3 rounded-xl border border-black/10 px-3.5 py-3.5"><span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-2 border-black/20" /><span className="text-sm font-medium leading-5">{action.title}</span></li>)}
                    {completed.map((action) => <li key={action.id} className="flex items-start gap-3 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-3 text-[var(--onboarding-muted,#475569)]"><span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--onboarding-primary,#1E3A5F)] text-xs text-white">✓</span><span className="text-sm leading-5 line-through">{action.title}</span></li>)}
                </ul>
            </div>
        </PortalSection>
        <PortalSection id="fulfilment-progress" title="Fulfilment progress" description="A simple view of where each service currently stands." icon="progress">
            <div className="mt-5 min-h-0 overflow-y-auto">
                {!overview.progress.length ? <div className="rounded-2xl bg-black/[0.025] px-4 py-9 text-center"><PortalIcon name="progress" className="mx-auto h-8 w-8 text-[var(--onboarding-muted,#475569)]" /><p className="mt-3 text-sm font-semibold">Your team is preparing fulfilment</p><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Your service progress will appear here as the delivery plan is prepared.</p></div> : <ul className="divide-y divide-black/[0.07] rounded-xl border border-black/[0.08]">
                    {overview.progress.map((service) => <li key={service.id} className="flex min-w-0 items-center justify-between gap-4 px-4 py-4"><span className="min-w-0 truncate text-sm font-semibold">{service.serviceName}</span><Status surface="light" label={progressLabels[service.status]} tone={tones[service.status]} /></li>)}
                </ul>}
            </div>
        </PortalSection>
    </div>
}
