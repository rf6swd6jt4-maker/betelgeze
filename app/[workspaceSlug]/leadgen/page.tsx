import Link from "next/link"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { LEADGEN_HISTORY_PAGE_SIZE, leadgenHistoryCursor } from "@/lib/leadgen/history"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }

export default async function LeadgenCompanyArchive({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const { before, beforeId } = await searchParams
    const cursor = leadgenHistoryCursor(before, beforeId)
    let query = supabaseAdmin.from("leadgen_companies")
        .select("id, display_name, owner_name, qualification_status, source_key, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(LEADGEN_HISTORY_PAGE_SIZE + 1)
    if (cursor) query = query.or(`created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`)
    const result = await query
    if (result.error) throw new Error("Could not load saved Lead Gen companies. Please retry.")
    const rows = result.data ?? []
    const companies = rows.slice(0, LEADGEN_HISTORY_PAGE_SIZE)
    const last = companies.at(-1)
    const olderHref = rows.length > LEADGEN_HISTORY_PAGE_SIZE && last
        ? `/${workspace.slug}/leadgen?${new URLSearchParams({ before: last.created_at, beforeId: last.id })}` : null
    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-6 sm:pb-6"><div className="mx-auto max-w-7xl">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
        <PanelTabHeader title="Saved leads" description="Read-only archive of Lead Gen companies." actions={<Link className="text-sm text-blue-300 underline" href={`/${workspace.slug}/leadgen/polls`}>Poll history</Link>} />
        <List ariaLabel="Saved Lead Gen companies">
            {companies.map((company) => <ListItem key={company.id}>
                <ListPrimaryRow>
                    <ListTitle href={`/${workspace.slug}/leadgen/company/${company.id}`}>{company.owner_name ? `${company.owner_name} · ${company.display_name}` : company.display_name}</ListTitle>
                    <Status label={company.qualification_status ?? "Saved"} tone={company.qualification_status === "qualified" ? "green" : "grey"} />
                </ListPrimaryRow>
                <ListSecondaryRow>{company.source_key} · {formatRelativeTime(company.created_at)} · {shortId(company.id)}</ListSecondaryRow>
            </ListItem>)}
            {!companies.length ? <p className="p-5 text-sm text-neutral-400">No saved companies on this page.</p> : null}
        </List>
        <nav aria-label="Saved leads pages" className="mt-5 flex justify-between gap-4 text-sm text-neutral-300">
            {cursor ? <Link href={`/${workspace.slug}/leadgen`} prefetch={false}>Newest leads</Link> : <span />}
            {olderHref ? <Link href={olderHref} prefetch={false}>Older leads</Link> : null}
        </nav>
    </div></main>
}
