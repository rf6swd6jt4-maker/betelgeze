import { redirect } from "next/navigation"
import { requireWorkspaceMember } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { workspaceHref } from "@/lib/relationships"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{
        id: string
    }>
}

export default async function ClientDetailPage({ params }: PageProps) {
    const { workspace } = await requireWorkspaceMember()
    const { id } = await params

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("relationship_id")
        .eq("id", id)
        .eq("workspace_id", workspace.id)
        .maybeSingle()

    if (client?.relationship_id) {
        redirect(workspaceHref(workspace.slug, `relationships/${client.relationship_id}`))
    }

    redirect(workspaceHref(workspace.slug, "relationships"))
}
