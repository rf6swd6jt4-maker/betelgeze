import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

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

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Leads</h2>
                    <p className="mt-1 text-sm text-neutral-500">Real companies collected from source polls. Enrichment, scoring, and CRM routing come later.</p>
                </div>
                {companies.length ? <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-5 py-3 font-medium">Company</th>
                                <th className="px-5 py-3 font-medium">Phone</th>
                                <th className="px-5 py-3 font-medium">Source</th>
                                <th className="px-5 py-3 font-medium">Industry</th>
                                <th className="px-5 py-3 font-medium">Location</th>
                                <th className="px-5 py-3 font-medium">Rating</th>
                                <th className="px-5 py-3 font-medium">Added</th>
                            </tr>
                        </thead>
                        <tbody>
                            {companies.map((company) => {
                                const address = company.address && typeof company.address === "object" && "city" in company.address ? company.address as { city?: string; state?: string } : null
                                return <tr key={company.id} className="border-t border-neutral-800">
                                    <td className="px-5 py-3">
                                        <p className="font-medium text-neutral-100">{company.display_name}</p>
                                        {(company.website_url || company.profile_url) && <a href={company.website_url ?? company.profile_url ?? "#"} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-neutral-500 underline underline-offset-4 hover:text-white">Open source record</a>}
                                    </td>
                                    <td className="px-5 py-3 text-neutral-300">{company.phone || "—"}</td>
                                    <td className="px-5 py-3 capitalize text-neutral-300">{company.source_key}</td>
                                    <td className="px-5 py-3 text-neutral-300">{String(company.industry_value ?? "—").replace(/_/g, " ")}</td>
                                    <td className="px-5 py-3 text-neutral-300">{[address?.city, address?.state].filter(Boolean).join(", ") || String(company.location_value ?? "—").replace(/_/g, " ")}</td>
                                    <td className="px-5 py-3 text-neutral-300">{company.rating ? `${company.rating} (${company.review_count ?? 0})` : "—"}</td>
                                    <td className="px-5 py-3 text-neutral-400">{new Date(company.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                </div> : <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
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
