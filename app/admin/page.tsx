import { redirect } from "next/navigation"
import { requireWorkspaceMember } from "@/lib/admin/auth"
import { workspaceHref } from "@/lib/relationships"

export default async function AdminPage() {
    const { workspace } = await requireWorkspaceMember()
    redirect(workspaceHref(workspace.slug, "relationships"))
}
