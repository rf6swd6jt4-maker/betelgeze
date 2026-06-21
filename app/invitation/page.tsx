import { supabaseAdmin } from "@/lib/supabase/admin"
import { InvitationChoices } from "@/components/auth/InvitationChoices"

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
    const { token, email } = await searchParams
    const { data: invite } = token ? await supabaseAdmin.from("workspace_invitations").select("email, expires_at, accepted_at, workspaces!inner(name)").eq("id", token).maybeSingle() : { data: null }
    const workspace = invite?.workspaces as unknown as { name: string } | null
    const valid = invite && !invite.accepted_at && new Date(invite.expires_at) > new Date() && email?.toLowerCase() === invite.email.toLowerCase()
    return <InvitationChoices valid={Boolean(valid)} workspaceName={workspace?.name ?? "this"} email={email ?? ""} token={token ?? ""} />
}
