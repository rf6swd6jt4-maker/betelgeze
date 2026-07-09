"use server"

import { redirect } from "next/navigation"
import { workspaceHref } from "@/lib/relationships"

export async function createWorkspaceClient(slug: string) {
    redirect(workspaceHref(slug, "relationships/new"))
}
