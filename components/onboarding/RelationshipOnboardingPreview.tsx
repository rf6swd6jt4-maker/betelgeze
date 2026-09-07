import { notFound } from "next/navigation"
import { OnboardingPreviewButton } from "@/components/onboarding-builder/OnboardingPreviewOverlay"
import { fullyAccessibleRelationshipIds, requireWorkspacePanel } from "@/lib/workspace-access"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"
import { loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function RelationshipOnboardingPreview({ workspaceSlug, relationshipId }: { workspaceSlug: string; relationshipId: string }) {
    const { workspace, access } = await requireWorkspacePanel(workspaceSlug, "onboarding")
    const allowed = await fullyAccessibleRelationshipIds(access)
    if (allowed && !allowed.has(relationshipId)) notFound()
    const [relationship, services, configuration, branding, assets] = await Promise.all([
        supabaseAdmin.from("relationships").select("id, primary_person_name, primary_email, primary_phone")
            .eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle(),
        supabaseAdmin.from("relationship_services").select("service_id, service_key")
            .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        loadPublishedOnboardingConfiguration(workspace.id),
        loadWorkspacePublicBranding(workspace.id, workspace.name),
        loadWorkspaceClientBrandAssets(workspace.id),
    ])
    if (relationship.error) throw new Error(relationship.error.message)
    if (!relationship.data) notFound()
    if (services.error) throw new Error(services.error.message)
    // Match POS composition: published mandatory modules plus the selected services,
    // in canonical order. Never read session progress, submissions, or client tokens.
    const selectedModuleIds = new Set([
        ...configuration.modules.filter((module) => module.mandatory).map((module) => module.id),
        ...configuration.services.filter((service) => services.data.some((selected) =>
            selected.service_id === service.id || selected.service_key === service.code
        )).flatMap((service) => service.modules.map((module) => module.moduleId)),
    ])
    const [logoSrc, modules] = await Promise.all([
        assets.logoPath ? createPrivateUploadSignedUrl(assets.logoPath) : null,
        Promise.all(configuration.modules.filter((module) => selectedModuleIds.has(module.id)).map(async (module) => ({
            ...module,
            steps: await Promise.all(module.steps.map(async (step) => ({
                ...step,
                resolvedVideoUrl: step.videoPath ? await createPrivateUploadSignedUrl(step.videoPath) : step.videoUrl,
                blocks: step.blocks ? await Promise.all(step.blocks.map(async (block) => block.kind === "video" && block.upload?.path
                    ? { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
                    : block)) : undefined,
            }))),
        }))),
    ])
    return <OnboardingPreviewButton modules={modules} payment={configuration.payment} theme={configuration.theme}
        help={configuration.help} workspaceName={branding.displayName} logoSrc={logoSrc}
        client={{ name: relationship.data.primary_person_name, email: relationship.data.primary_email, phone: relationship.data.primary_phone, isTest: false }}
        privacyPolicyUrl={branding.privacyPolicyUrl} termsOfServiceUrl={branding.termsOfServiceUrl} />
}
