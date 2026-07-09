"use server"

import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { workspaceHref } from "@/lib/relationships"

export async function createClient() {
    const { workspace } = await requireAdmin()
    redirect(workspaceHref(workspace.slug, "relationships/new"))
}
