"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeWorkspaceBanner } from "@/lib/onboarding/uploads"

function refresh(slug: string) {
    revalidatePath(`/dashboard/${slug}`)
    revalidatePath(`/dashboard/${slug}/settings`)
}

export async function updateWorkspaceName(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    if (name.length < 2 || name.length > 100) throw new Error("Workspace names must be between 2 and 100 characters.")
    const { error } = await supabaseAdmin.from("workspaces").update({ name }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace name.")
    refresh(slug)
}

export async function uploadWorkspaceBanner(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("banner")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const bannerPath = await storeWorkspaceBanner(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ banner_path: bannerPath }).eq("id", workspace.id)
    if (error) throw new Error("The banner uploaded, but could not be saved to this workspace.")
    refresh(slug)
}
