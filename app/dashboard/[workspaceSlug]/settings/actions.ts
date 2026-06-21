"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeWorkspaceImage } from "@/lib/onboarding/uploads"

function refresh(slug: string) {
    revalidatePath(`/dashboard/${slug}`)
    revalidatePath(`/dashboard/${slug}/settings`)
}

export async function updateWorkspaceBranding(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    if (name.length < 2 || name.length > 100) throw new Error("Workspace names must be between 2 and 100 characters.")
    const bannerHeight = Number(formData.get("bannerHeight"))
    const bannerPosition = Number(formData.get("bannerPosition"))
    if (!Number.isInteger(bannerHeight) || bannerHeight < 192 || bannerHeight > 288) throw new Error("Banner height must be between 192px and 288px.")
    if (!Number.isInteger(bannerPosition) || bannerPosition < 0 || bannerPosition > 100) throw new Error("Banner position must be between 0 and 100.")
    const { error } = await supabaseAdmin.from("workspaces").update({ name, banner_height: bannerHeight, banner_position: bannerPosition }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace branding.")
    refresh(slug)
}

export async function uploadWorkspaceBanner(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("banner")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const bannerPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ banner_path: bannerPath }).eq("id", workspace.id)
    if (error) throw new Error("The banner uploaded, but could not be saved to this workspace.")
    refresh(slug)
}

export async function uploadWorkspaceLogo(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("logo")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const logoPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ logo_path: logoPath }).eq("id", workspace.id)
    if (error) throw new Error("The logo uploaded, but could not be saved to this workspace.")
    refresh(slug)
}
