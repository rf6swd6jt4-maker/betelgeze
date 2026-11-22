import { LoadingPulse, PanelLoadingTabs } from "@/components/panel/PanelLoading"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"

/**
 * Opening states for the Campaigns pages, shared by their route fallbacks and the shell's opening state. Each one has
 * its page's geometry: the same top spacing, header, tabs and first block, so nothing moves when the page arrives.
 */
const frame = "min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-10 pt-5 text-white sm:px-6"

function HeaderLoading({ label, tabs = false, actions = 1 }: { label: string; tabs?: boolean; actions?: number }) {
    return <header aria-hidden="true">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 pb-4">
            <LoadingPulse className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
                <h1 className="sr-only">{label}</h1>
                <LoadingPulse className="h-7 w-56 max-w-[70%]" />
                <div className="mt-1.5 flex items-center gap-3"><LoadingPulse className="h-4 w-14" /><LoadingPulse className="h-4 w-20" /><LoadingPulse className="h-4 w-24" /></div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{Array.from({ length: actions }, (_, index) => <LoadingPulse key={index} className="h-11 w-24 sm:h-7" />)}</div>
        </div>
        {tabs ? <PanelLoadingTabs count={4} active={0} /> : <div className="border-b border-card-border" />}
    </header>
}

/** A campaign: its header and tabs, the source filters, then the pipeline's columns. */
export function CampaignPageLoading() {
    return <main data-workspace-loading-root aria-label="Opening campaign" aria-busy="true" className={frame}>
        <div className="mx-auto max-w-7xl">
            <HeaderLoading label="Campaign" tabs />
            <div aria-hidden="true" className="mt-5 flex gap-2">{[44, 82, 82, 108].map(width => <LoadingPulse key={width} className="h-7" style={{ width }} />)}</div>
            <div aria-hidden="true" className="-mx-2 mt-5 grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-4 overflow-hidden px-2">
                {[3, 2, 2, 1, 1, 0, 0].map((cards, column) => <div key={column} className="flex min-h-48 flex-col p-1">
                    <LoadingPulse className="mx-1 mb-3 h-4 w-24" />
                    {Array.from({ length: cards }, (_, card) => <div key={card} className="border-t border-card-border px-2 py-2.5 first-of-type:border-t-0"><LoadingPulse className="h-4 w-32" /><LoadingPulse className="mt-2 h-3 w-24" /></div>)}
                </div>)}
            </div>
        </div>
    </main>
}

/** A source: the record header, the status bar, then settings rows. */
export function CampaignSourceLoading() {
    return <main data-workspace-loading-root aria-label="Opening source" aria-busy="true" className={frame}>
        <div className="mx-auto max-w-4xl" aria-hidden="true">
            <div className="border-b border-card-border pb-4"><LoadingPulse className="h-3 w-24" /><LoadingPulse className="mt-2 h-7 w-56" /><LoadingPulse className="mt-2 h-4 w-40" /></div>
            <div className="mt-5 flex items-center gap-3"><LoadingPulse className="h-5 w-20" /><LoadingPulse className="h-4 w-72 max-w-[50%]" /></div>
            <div className="mt-8 flex flex-col gap-3">{Array.from({ length: 6 }, (_, row) => <div key={row} className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"><LoadingPulse className="h-4 w-24" /><LoadingPulse className="h-9 w-full max-w-md" /></div>)}</div>
        </div>
    </main>
}

/** A lead: the header with stage and Mark sold, then the appointment beside the details column. */
export function CampaignLeadLoading() {
    return <main data-workspace-loading-root aria-label="Opening lead" aria-busy="true" className={frame}>
        <div className="@container mx-auto max-w-6xl">
            <div className="border-b border-card-border"><HeaderLoading label="Lead" actions={2} /></div>
            <div aria-hidden="true" className="flex flex-col gap-8 pt-5 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:gap-x-10">
                <div className="flex flex-col gap-3"><LoadingPulse className="h-3 w-20" /><LoadingPulse className="h-6 w-64" /><LoadingPulse className="h-4 w-80 max-w-full" /><LoadingPulse className="mt-6 h-3 w-16" />{[0, 1, 2].map(row => <LoadingPulse key={row} className="h-4 w-full max-w-lg" />)}</div>
                <div className="flex flex-col gap-3"><LoadingPulse className="h-3 w-16" />{[0, 1, 2, 3].map(row => <div key={row} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2"><LoadingPulse className="h-4 w-14" /><LoadingPulse className="h-4 w-full" /></div>)}</div>
            </div>
        </div>
    </main>
}

export function NewCampaignLoading() {
    return <main data-workspace-loading-root aria-label="Opening new campaign" aria-busy="true" className={frame}>
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="New campaign" description="A campaign starts as a draft. Add its sources next: the landing pages your ads send people to." />
            <div aria-hidden="true" className="mt-5 flex max-w-xl items-center gap-3"><LoadingPulse className="h-9 flex-1" /><LoadingPulse className="h-9 w-36" /></div>
        </div>
    </main>
}
