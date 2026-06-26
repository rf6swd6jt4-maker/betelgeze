import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListAutoRefresh } from "@/components/list/ListAutoRefresh"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { removeLeadgenCompany } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function LeadgenWorkspacePage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const companiesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, website_url, profile_url, source_key, address, rating, review_count, industry_value, location_value, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(100)
    const companies = companiesResult.error ? [] : companiesResult.data ?? []
    const callable = companies.filter((company) => Boolean(company.phone)).length
    const withProfiles = companies.filter((company) => Boolean(company.profile_url || company.website_url)).length

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <ListAutoRefresh />
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                    <p className="mt-2 text-sm text-neutral-400">Review and route the highest quality leads for this workspace. Signed in as {role}.</p>
                </div>
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="leads" />

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                    ["Collected leads", companies.length],
                    ["With phone", callable],
                    ["With source profile", withProfiles],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                {companies.length ? companies.map((company) => {
                    const sourceUrl = company.website_url ?? company.profile_url ?? null
                    return <div key={company.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-900 px-4 py-2.5 last:border-0 md:grid-cols-[minmax(250px,1.4fr)_150px_170px_150px_100px_120px_32px] md:items-center">
                        <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-neutral-100">{company.display_name}</p>
                        </div>
                        <span className={`inline-flex items-center gap-2 text-sm ${company.phone ? "text-emerald-200" : "text-neutral-400"}`}><span className={`h-2 w-2 rotate-45 ${company.phone ? "bg-emerald-300" : "bg-neutral-500"}`} />{company.phone ? "Callable" : "No phone"}</span>
                        <p className="truncate text-sm capitalize text-neutral-400">{company.source_key}</p>
                        <p className="truncate text-sm text-neutral-400">{String(company.industry_value ?? "—").replace(/_/g, " ")}</p>
                        <p className="font-mono text-sm text-neutral-500">{shortId(company.id)}</p>
                        <p className="whitespace-nowrap text-right text-sm text-neutral-500">{formatRelativeTime(company.created_at)}</p>
                        <ListActionMenu actions={[
                            sourceUrl ? { label: "Open source", href: sourceUrl, external: true } : {},
                            { label: "Remove", action: removeLeadgenCompany.bind(null, workspace.slug, company.id), danger: true },
                        ]} />
                    </div>
                }) : <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Starting clean</p>
                        <h3 className="mt-3 text-xl font-semibold">No real companies have been collected yet.</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">Configure OpenStreetMap in Settings, choose industries and locations, then run a poll. Only actual stored source records appear here.</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Next action</p>
                        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                            <li>• Select OpenStreetMap, industries, and locations in Settings.</li>
                            <li>• Run a test poll from the Polls tab.</li>
                            <li>• Review collected companies here.</li>
                        </ul>
                    </div>
                </div>}
            </section>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
