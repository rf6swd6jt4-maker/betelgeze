"use server"

import { redirect } from "next/navigation"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"
import { requireWorkspace } from "@/lib/workspaces"

export async function createWorkspaceClient(slug: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    if (!name) redirect(`/dashboard/${slug}/clients/new?error=missing-name`)
    await createOnboardingClient({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        name,
        email,
        phone: "",
        serviceKeys: [],
        createClickUpResources: false,
        createdBy: user.id,
    })
    redirect(`/dashboard/${slug}`)
}
