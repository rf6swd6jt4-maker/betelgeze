import { DocumentCatalogue } from "@/components/ui/DocumentCatalogue"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
export default function SopsLoading() {
    return <main data-workspace-loading-root aria-busy="true" aria-label="Loading SOPs" className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6"><div className="mx-auto max-w-7xl"><PanelTabHeader title="SOPs" description="Standard operating procedures and reference documents for your team." /><div className="mt-5"><DocumentCatalogue label="Loading SOP catalogue">{[0, 1, 2, 3].map((id) => <div key={id} role="listitem" className="aspect-square animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />)}</DocumentCatalogue></div></div></main>
}
