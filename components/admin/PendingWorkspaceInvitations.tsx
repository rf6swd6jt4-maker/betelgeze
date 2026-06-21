import { supabaseAdmin } from "@/lib/supabase/admin"

export async function PendingWorkspaceInvitations({ workspaceId }: { workspaceId: string }) {
    const { data: invitations } = await supabaseAdmin.from("workspace_invitations").select("id, email, role, expires_at").eq("workspace_id", workspaceId).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
    if (!invitations?.length) return null
    const users = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    return <div className="overflow-hidden rounded-2xl border border-amber-400/20 bg-amber-500/5">{invitations.map((invite) => { const registered = users.data.users.some((user) => user.email?.toLowerCase() === invite.email.toLowerCase()); return <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/15 p-4 last:border-0 sm:p-5"><div><p className="break-words font-medium">{invite.email}</p><p className="mt-1 text-sm text-amber-100/75">{registered ? "On Betelgeze — invitation not accepted" : "Not on Betelgeze yet"} · {invite.role}</p></div><span className="rounded-full border border-amber-300/20 px-3 py-1 text-xs text-amber-100">Pending</span></div> })}</div>
}
