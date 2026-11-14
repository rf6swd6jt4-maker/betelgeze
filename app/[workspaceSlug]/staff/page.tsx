import { Assignee, SquarePill } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadStaffWorkload } from "@/lib/staff-server"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { workspaceRoleLabel } from "@/lib/workspace-roles"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

function holdings(row: { clients: number; services: number; queues: number; tasks: number }) {
    const parts = [
        row.clients ? `${row.clients} client${row.clients === 1 ? "" : "s"} managed` : null,
        row.services ? `${row.services} service${row.services === 1 ? "" : "s"}` : null,
        row.queues ? `${row.queues} shared queue${row.queues === 1 ? "" : "s"}` : null,
        row.tasks ? `${row.tasks} open task${row.tasks === 1 ? "" : "s"}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(" · ") : "Nothing assigned"
}

export default async function StaffPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const rows = await loadStaffWorkload(workspace.id, user.id)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="Staff" description="Who holds which clients, services and open tasks. Open someone to move their work." />
            {rows === null ? <p role="status" className="mt-5 text-sm text-neutral-400">The Staff panel needs a database update that has not been applied yet.</p> : <>
                <div className="mt-5"><QuickStats items={[
                    { label: "People", value: rows.length },
                    { label: "Clients managed", value: rows.reduce((sum, row) => sum + row.clients, 0) },
                    { label: "Open tasks", value: rows.reduce((sum, row) => sum + row.tasks, 0) },
                ]} /></div>
                <div className="mt-5"><List ariaLabel="Staff">{rows.map(row => <ListItem key={row.userId}>
                    <ListPrimaryRow>
                        <ListTitle href={`/${workspace.slug}/staff/${row.userId}`}>{row.name}</ListTitle>
                        <SquarePill tone="neutral">{workspaceRoleLabel(row.role)}</SquarePill>
                    </ListPrimaryRow>
                    <ListSecondaryRow>
                        <span className="flex min-w-0 items-center gap-2"><span className="shrink-0"><Assignee name={row.name} avatarSrc={row.avatarSrc} compact /></span><span className="truncate text-neutral-400">{holdings(row)}</span></span>
                        <ListTrailing>{row.joinedAt ? <span className="hidden text-neutral-500 sm:inline">Joined {formatRelativeTime(row.joinedAt)} ago</span> : null}</ListTrailing>
                    </ListSecondaryRow>
                </ListItem>)}</List></div>
            </>}
        </div>
    </main>
}
