import { AccountMenu } from "@/components/account/AccountMenu"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Props = { userId: string; workspace: { id: string; name: string } }

export async function LeadgenMenus({ userId, workspace }: Props) {
    const [{ data: profile }, { data: authResult }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
    ])
    const username = profile?.username ?? "account"
    const avatarSrc = profile?.avatar_path ? await createUploadSignedUrl(profile.avatar_path) : null

    return <AccountMenu username={username} email={authResult.user?.email ?? ""} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveWorkspace.bind(null, username)} />
}
