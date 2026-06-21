import { AccountMenu } from "@/components/account/AccountMenu"
import { AdminActionsMenu } from "@/components/admin/AdminActionsMenu"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"

type Props = { userId: string; workspace: { id: string; name: string } }

export async function DashboardMenus({ userId, workspace }: Props) {
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username").eq("user_id", userId).maybeSingle()
    const username = profile?.username ?? "account"
    return <div className="flex items-center gap-2"><AdminActionsMenu /><AccountMenu username={username} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveWorkspace.bind(null, username)} /></div>
}
