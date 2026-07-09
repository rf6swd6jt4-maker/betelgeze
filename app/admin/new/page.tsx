import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { workspaceHref } from "@/lib/relationships"

export const dynamic = "force-dynamic"

export default async function NewClientPage() {
    const { workspace } = await requireAdmin()
    redirect(workspaceHref(workspace.slug, "relationships/new"))
}
