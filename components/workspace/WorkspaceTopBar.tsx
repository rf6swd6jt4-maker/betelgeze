import { WorkspaceTopBarClient } from "@/components/workspace/WorkspaceTopBarClient"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Product = "client-work" | "leadgen"

type Props = {
    userId: string
    workspace: { id: string; name: string; slug: string; logo_path?: string | null }
    currentProduct: Product
}

export async function WorkspaceTopBar({ userId, workspace }: Props) {
    const [{ data: profile }, { data: authResult }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
    ])
    const username = profile?.username ?? "account"
    const [avatarSrc, workspaceLogoSrc] = await Promise.all([
        profile?.avatar_path ? createUploadSignedUrl(profile.avatar_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])

    return <WorkspaceTopBarClient workspace={workspace} workspaceLogoSrc={workspaceLogoSrc} username={username} email={authResult.user?.email ?? ""} avatarSrc={avatarSrc} leaveAction={leaveWorkspace.bind(null, username)} />
}
