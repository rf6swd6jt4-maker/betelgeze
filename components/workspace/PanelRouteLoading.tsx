import { DocumentCatalogue } from "@/components/ui/DocumentCatalogue"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { ActivityTrendsLoading, LoadingPulse, OnboardingPanelLoading, PanelLoadingFilters, PanelLoadingFrame, PanelLoadingGallery, PanelLoadingList, PanelLoadingStats, PanelLoadingTabs } from "@/components/panel/PanelLoading"
import { DetailRouteLoading } from "@/components/workspace/DetailRouteLoading"

export type PanelLoadingVariant =
    | "admin"
    | "admin-activity"
    | "admin-maintenance"
    | "admin-okrs"
    | "client-connections"
    | "assets"
    | "communications"
    | "communications-team"
    | "fulfilment"
    | "leadgen"
    | "leadgen-polls"
    | "onboarding"
    | "notes"
    | "relationships"
    | "queue"
    | "sops"
    | "settings"
    | "work-items"
    | "detail"

function RelationshipsLoading() {
    return <PanelLoadingFrame title="Relationships">
        <PanelTabHeader title="Relationships" description="People, businesses and the services you deliver together." actions={<LoadingPulse className="h-11 w-full sm:h-10 sm:w-32" />} />
        <PanelLoadingFilters widths={[54, 70, 104, 64, 86, 78]} />
        <PanelLoadingList kind="relationship" />
    </PanelLoadingFrame>
}

function QueueLoading() {
    return <PanelLoadingFrame title="Work Queue">
        <PanelTabHeader title="Work Queue" description="Your ready work, ordered by value, timing and what it enables." />
        <PanelLoadingStats labels={["Ready", "Waiting", "Open work"]} />
        <PanelLoadingFilters widths={[92, 152]} />
        <PanelLoadingList rows={5} />
    </PanelLoadingFrame>
}

function SopsLoading() {
    return <PanelLoadingFrame title="SOPs">
        <PanelTabHeader title="SOPs" description="Team procedures and supporting files." tabs={<PanelLoadingTabs active={1} />} />
        <div className="mt-5"><div className="mb-4 flex items-center justify-between gap-3"><LoadingPulse className="h-4 w-64 max-w-[70%]" /><LoadingPulse className="h-4 w-16" /></div><DocumentCatalogue label="Loading SOP catalogue">{[0, 1, 2, 3].map((id) => <div key={id} role="listitem" className="aspect-square rounded-xl border border-neutral-800 bg-neutral-900 motion-safe:animate-pulse" />)}</DocumentCatalogue></div>
    </PanelLoadingFrame>
}

function OnboardingLoading() {
    return <PanelLoadingFrame title="Onboarding">
        <PanelTabHeader title="Onboarding" description="Relationship onboarding work, submitted information, and assigned delivery setup." />
        <OnboardingPanelLoading />
    </PanelLoadingFrame>
}

function WorkItemsLoading({ fulfilment = false }: { fulfilment?: boolean }) {
    const title = fulfilment ? "Fulfilment" : "Work Items"
    return <PanelLoadingFrame title={title}>
        <PanelTabHeader title={title} description={fulfilment ? "Open fulfilment work shared with its relationship record." : "Workspace tasks ordered by their most recent update."} actions={fulfilment ? undefined : <LoadingPulse className="h-11 w-full sm:h-10 sm:w-32" />} tabs={fulfilment ? undefined : <PanelLoadingTabs />} />
        <PanelLoadingStats labels={fulfilment ? ["Open work", "Relationships", "Blocked", "Due/ready"] : ["Total", "Open", "Blocked", "Due/ready"]} hideOnMobileIndex={fulfilment ? 1 : 0} />
        <PanelLoadingFilters widths={fulfilment ? [70, 74, 86] : [54, 62, 74, 92]} />
        <PanelLoadingList />
    </PanelLoadingFrame>
}

function ClientConnectionsLoading() {
    return <PanelLoadingFrame title="Client Connections">
        <div className="pt-5">
            <PanelTabHeader title="Client Connections" description="Connect client accounts to the systems used to deliver their services." actions={<LoadingPulse className="h-10 w-full sm:w-32" />} />
            <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5" aria-label="Loading agency connection">
                <LoadingPulse className="h-5 w-44" /><LoadingPulse className="mt-2 h-4 w-96 max-w-full" /><LoadingPulse className="mt-4 h-4 w-56" />
            </section>
            <PanelLoadingList kind="relationship" rows={4} />
        </div>
    </PanelLoadingFrame>
}

function OkrTableSkeleton() {
    return <section aria-label="Loading Objectives and Key Result metrics" className="mt-5 overflow-hidden rounded-xl border border-neutral-800 bg-black">
        <div className="grid h-10 grid-cols-[minmax(0,1fr)_repeat(2,5.25rem)] border-b border-neutral-800 bg-neutral-950 px-4 sm:grid-cols-[minmax(13rem,1fr)_repeat(3,minmax(5.5rem,0.38fr))]">
            <LoadingPulse className="my-auto h-3 w-24" />
            {Array.from({ length: 3 }, (_, index) => <LoadingPulse key={index} className={`${index === 0 ? "hidden sm:block" : ""} my-auto ml-auto h-3 w-12`} />)}
        </div>
        {Array.from({ length: 3 }, (_, objectiveIndex) => <div key={objectiveIndex}>
            <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_repeat(2,5.25rem)] items-center border-b border-neutral-800 bg-neutral-900/65 px-4 sm:grid-cols-[minmax(13rem,1fr)_repeat(3,minmax(5.5rem,0.38fr))]">
                <div className="flex min-w-0 items-center gap-3"><LoadingPulse className="h-4 w-52 max-w-full" /><LoadingPulse className="h-4 w-16" /></div>
                <LoadingPulse className="col-span-2 ml-auto h-9 w-9 rounded-full sm:col-span-3" />
            </div>
            {Array.from({ length: objectiveIndex === 2 ? 1 : 2 }, (_, resultIndex) => <div key={resultIndex} className="grid h-12 grid-cols-[minmax(0,1fr)_repeat(2,5.25rem)] items-center border-b border-neutral-900 px-4 sm:grid-cols-[minmax(13rem,1fr)_repeat(3,minmax(5.5rem,0.38fr))]">
                <LoadingPulse className="ml-4 h-4 w-44 max-w-full bg-neutral-900" />
                {Array.from({ length: 3 }, (_, metricIndex) => <LoadingPulse key={metricIndex} className={`${metricIndex === 0 ? "hidden sm:block" : ""} ml-auto h-4 w-12 bg-neutral-900`} />)}
            </div>)}
        </div>)}
        <div className="flex h-12 items-center justify-end px-3"><LoadingPulse className="h-8 w-28 bg-neutral-900" /></div>
    </section>
}

function AdminLoading({ section = "work" }: { section?: "work" | "okrs" | "activity" | "maintenance" }) {
    const title = section === "okrs" ? "OKRs" : section === "activity" ? "Activity Console" : section === "maintenance" ? "Maintenance Queue" : "Work Queue"
    const description = section === "okrs" ? "Objectives and measurable Key Results for private workspace administration." : section === "activity" ? "Event stream of recorded operations across services, onboarding, billing, communications, Lead Gen, integrations, and Gantt automation." : section === "maintenance" ? "Actionable automation failures deduplicated into accountable Work Items. Repeated fingerprints update the open item; recurrence after resolution creates a new one." : "Ranked Admin work ordered by timing, dependencies, expected impact, ownership, and available capacity."
    return <PanelLoadingFrame title={title}>
        <PanelTabHeader title={title} description={description} tabs={<PanelLoadingTabs active={section === "work" ? 0 : section === "okrs" ? 1 : section === "maintenance" ? 2 : 3} />} />
        {section === "okrs" ? <OkrTableSkeleton /> : <>
        {section === "activity" ? <ActivityTrendsLoading /> : section === "maintenance" ? <PanelLoadingStats labels={["Open", "Resolved", "Occurrences", "Critical"]} hideOnMobileIndex={2} /> : section === "work" ? <PanelLoadingStats labels={["Actionable", "Reserved", "Deferred", "Capacity"]} hideOnMobileIndex={2} /> : null}
        {section === "work" ? <PanelLoadingFilters widths={[82, 74]} /> : <PanelLoadingFilters widths={section === "activity" ? [54, 62, 74, 58] : [58, 78]} />}
        {section !== "work" ? <PanelLoadingFilters tight widths={section === "activity" ? [92, 82, 104, 76, 88] : [104, 82, 96, 74]} /> : null}
        <PanelLoadingList />
        </>}
    </PanelLoadingFrame>
}

function LeadgenLoading({ polls = false }: { polls?: boolean }) {
    const title = polls ? "Poll history" : "Saved leads"
    return <PanelLoadingFrame title={title}>
        <PanelTabHeader title={title} description={polls ? "Read-only archive of saved Lead Gen polls." : "Read-only archive of Lead Gen companies."} />
        <PanelLoadingList />
    </PanelLoadingFrame>
}

function AssetsLoading() {
    return <PanelLoadingFrame title="Assets">
        <PanelTabHeader title="Assets" description="Workspace files and media available for relationship and work-item use." actions={<LoadingPulse className="h-11 w-full sm:h-10 sm:w-32" />} tabs={<PanelLoadingTabs active={2} />} />
        <PanelLoadingStats labels={["Total", "Images", "Documents", "Uploads"]} hideOnMobileIndex={0} />
        <PanelLoadingGallery />
    </PanelLoadingFrame>
}

function NotesLoading() {
    return <PanelLoadingFrame title="Notes">
        <PanelTabHeader title="Notes" description="Call notes and durable workspace context, ordered by their most recent update." actions={<LoadingPulse className="h-11 w-full sm:h-10 sm:w-32" />} tabs={<PanelLoadingTabs active={3} />} />
        <PanelLoadingStats labels={["Total", "Relationship links", "Asset links"]} />
        <PanelLoadingList rows={5} />
    </PanelLoadingFrame>
}

function Pulse({ className }: { className: string }) {
    return <LoadingPulse className={className} />
}

function CommunicationsLoading({ team = false }: { team?: boolean }) {
    return <main data-workspace-loading-root aria-label="Loading Communications" aria-busy="true" className="absolute inset-0 overflow-hidden bg-black text-white">
        <div className="grid h-full min-h-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-neutral-800 bg-neutral-950">
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center gap-2"><span className={`rounded-lg px-3 py-2 text-xs ${team ? "text-neutral-500" : "bg-neutral-800 font-semibold"}`}>Clients</span><span className={`rounded-lg px-3 py-2 text-xs ${team ? "bg-neutral-800 font-semibold" : "text-neutral-500"}`}>Team</span><Pulse className="ml-auto h-3 w-12" /></div>
                    <Pulse className="mt-3 h-10 w-full rounded-lg bg-black" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    {Array.from({ length: 7 }, (_, index) => <div key={index} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5">
                        <Pulse className="h-11 w-11 rounded-full" />
                        <div className="min-w-0"><Pulse className="h-4 w-2/3" /><Pulse className="mt-2 h-3 w-5/6 bg-neutral-900" /></div>
                    </div>)}
                </div>
            </aside>
            <section className="hidden min-h-0 flex-col lg:flex">
                <header className="flex h-[69px] shrink-0 items-center gap-3 border-b border-neutral-800 px-4"><Pulse className="h-10 w-10 rounded-full" /><div><Pulse className="h-4 w-36" /><Pulse className="mt-2 h-3 w-24 bg-neutral-900" /></div></header>
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden p-5">
                    <Pulse className="h-14 w-56 rounded-2xl bg-neutral-900" />
                    <Pulse className="ml-auto h-20 w-72 rounded-2xl bg-neutral-800" />
                    <Pulse className="h-16 w-64 rounded-2xl bg-neutral-900" />
                </div>
                <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-4"><Pulse className="mx-auto h-11 w-full max-w-3xl rounded-xl bg-black" /></footer>
            </section>
        </div>
    </main>
}

function SettingsLoading() {
    return <main data-workspace-loading-root aria-label="Loading Settings" aria-busy="true" className="min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl pt-5">
            <div className="relative mb-16 h-48 rounded-xl border border-neutral-800 bg-neutral-900 motion-safe:animate-pulse sm:h-64 sm:rounded-2xl"><div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" /></div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <nav aria-label="Loading settings sections" className="hidden space-y-3 lg:block">{Array.from({ length: 8 }, (_, index) => <Pulse key={index} className="h-10 w-full rounded-lg bg-neutral-900" />)}</nav>
                <div className="space-y-10">{[160, 240, 190].map((height, index) => <section key={index}><Pulse className="h-5 w-40" /><Pulse className="mt-2 h-4 w-72 max-w-full bg-neutral-900" /><div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/70 motion-safe:animate-pulse" style={{ height }} /></section>)}</div>
            </div>
        </div>
    </main>
}

export function PanelRouteLoading({ variant, title }: { variant: PanelLoadingVariant; title?: string }) {
    if (variant === "communications") return <CommunicationsLoading />
    if (variant === "communications-team") return <CommunicationsLoading team />
    if (variant === "queue") return <QueueLoading />
    if (variant === "sops") return <SopsLoading />
    if (variant === "settings") return <SettingsLoading />
    if (variant === "relationships") return <RelationshipsLoading />
    if (variant === "onboarding") return <OnboardingLoading />
    if (variant === "work-items") return <WorkItemsLoading />
    if (variant === "fulfilment") return <WorkItemsLoading fulfilment />
    if (variant === "client-connections") return <ClientConnectionsLoading />
    if (variant === "assets") return <AssetsLoading />
    if (variant === "notes") return <NotesLoading />
    if (variant === "leadgen") return <LeadgenLoading />
    if (variant === "leadgen-polls") return <LeadgenLoading polls />
    if (variant === "admin-activity") return <AdminLoading section="activity" />
    if (variant === "admin-maintenance") return <AdminLoading section="maintenance" />
    if (variant === "admin-okrs") return <AdminLoading section="okrs" />
    if (variant === "admin") return <AdminLoading />
    return <DetailRouteLoading title={title ?? "record"} />
}
