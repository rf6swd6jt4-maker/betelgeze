import Link from "next/link"

export function LeadgenTabs({ workspaceSlug, active }: { workspaceSlug: string; active: "leads" | "polls" }) {
    return <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Link href={`/${workspaceSlug}/leadgen`} className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === "leads" ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300"}`}>Leads</Link>
        <Link href={`/${workspaceSlug}/leadgen/polls`} className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${active === "polls" ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300"}`}>Polls</Link>
    </div>
}
