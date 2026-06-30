import Link from "next/link"
import { AccountMenu } from "@/components/account/AccountMenu"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { leaveWorkspace } from "@/app/users/[username]/actions"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Product = "client-work" | "leadgen"

type Props = {
    userId: string
    workspace: { id: string; name: string; slug: string }
    currentProduct: Product
}

export async function WorkspaceTopBar({ userId, workspace, currentProduct }: Props) {
    const [{ data: profile }, { data: authResult }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
    ])
    const username = profile?.username ?? "account"
    const avatarSrc = profile?.avatar_path ? await createUploadSignedUrl(profile.avatar_path) : null
    const switchHref = currentProduct === "leadgen"
        ? `/dashboard/${workspace.slug}`
        : `/leadgen/${workspace.slug}`
    const switchLabel = currentProduct === "leadgen" ? "Client work" : "Lead gen"

    return <div className="mb-4 flex items-center justify-between gap-3 text-sm">
        <Link href={`/users/${username}`} className="text-neutral-500 transition hover:text-neutral-200">← Workspaces</Link>
        <div className="flex items-center gap-2">
            <Link href={switchHref} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 transition hover:border-neutral-600 hover:text-white">{switchLabel}</Link>
            <AccountMenu username={username} email={authResult.user?.email ?? ""} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveWorkspace.bind(null, username)} buttonClassName="h-10 w-10 sm:h-9 sm:w-9" />
        </div>
    </div>
}
