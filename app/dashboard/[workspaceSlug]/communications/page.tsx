import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    listRelationshipsForWorkspace,
    relationshipHubHref,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function CommunicationsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = (await listRelationshipsForWorkspace(workspace.id))
        .filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id))
    const { data: messages } = clientIds.length
        ? await supabaseAdmin
            .from("client_messages")
            .select("client_id, body, direction, provider, status, created_at")
            .in("client_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(120)
        : { data: [] }
    const latestMessageByClient = new Map<string, NonNullable<typeof messages>[number]>()
    for (const message of messages ?? []) {
        if (!latestMessageByClient.has(message.client_id)) latestMessageByClient.set(message.client_id, message)
    }

    const rows = relationships
        .map((relationship) => ({
            relationship,
            latestMessage: relationship.client_id ? latestMessageByClient.get(relationship.client_id) ?? null : null,
        }))
        .filter((row) => row.latestMessage)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Communications</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Placeholder home for relationship communication summaries. Chat-style detail pages will replace the old ClickUp chat channel workflow in a later focused push.
                        </p>
                    </div>
                </header>

                <section className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                    {[
                        ["Relationships", relationships.length],
                        ["With messages", rows.length],
                        ["Chat details", "Next"],
                    ].map(([label, value]) => (
                        <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-xl font-semibold">{value}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {rows.length ? rows.map(({ relationship, latestMessage }) => (
                        <Link key={relationship.id} href={relationshipHubHref(workspace.slug, relationship.id)} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 lg:grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.2fr)_130px_130px] lg:items-center">
                            <div className="min-w-0">
                                <p className="truncate font-medium text-neutral-100">{relationship.primary_person_name}</p>
                                <p className="mt-1 truncate text-sm text-neutral-500">{relationship.business_name ?? relationship.primary_phone ?? relationship.primary_email ?? "No context saved"}</p>
                            </div>
                            <p className="line-clamp-2 text-sm text-neutral-300">{latestMessage?.body ?? "No message body saved"}</p>
                            <p className="text-sm capitalize text-neutral-500">{latestMessage?.direction ?? "message"}</p>
                            <p className="text-sm text-neutral-500 lg:text-right">{latestMessage ? formatRelativeTime(latestMessage.created_at) : "No messages"}</p>
                        </Link>
                    )) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No relationship communications yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                This panel will list relationships by recent communication activity, then open chat-style detail pages for each relationship.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
