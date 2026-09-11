import 'server-only'
import { workspacePerformanceEnabled } from "@/lib/workspace-native"
import type { RelationshipRecord } from '@/lib/relationships'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadPublishedOnboardingConfiguration } from '@/lib/onboarding/configuration'
import { buildRelationshipDealServiceOptions } from '@/lib/onboarding/service-display'
import { loadOnboardingServiceRevisionDisplays } from '@/lib/onboarding/service-revisions'
import { currentRelationshipWork } from '@/lib/relationship-workflow'
import { loadWorkspaceOperations } from '@/lib/teams/operations'
import { loadWorkspaceClientBrandAssets } from '@/lib/client-branding/assets'
import { loadWorkspacePublicBranding } from '@/lib/client-branding/public-branding'
import { createPrivateUploadSignedUrl } from '@/lib/onboarding/uploads'

export async function loadNativeRelationshipDeal({ workspaceId, workspaceSlug, workspaceName, userId, role, relationship }: {
    workspaceId: string
    workspaceSlug: string
    workspaceName: string
    userId: string
    role: string
    relationship: RelationshipRecord
}) {
    const [servicesResult, onboardingConfiguration, currentSaleResult, operations, twilioConnectionResult, publicBranding, brandAssets, currentWork] = await Promise.all([
        supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, upfront_price_cents, recurring_price_cents, currency, assignee_user_id").eq("workspace_id", workspaceId).eq("relationship_id", relationship.id),
        loadPublishedOnboardingConfiguration(workspaceId),
        supabaseAdmin.from("client_sales")
            .select("id, status, stripe_checkout_session_id, stripe_checkout_status, stripe_checkout_url, created_at")
            .eq("workspace_id", workspaceId)
            .eq("relationship_id", relationship.id)
            .in("status", ["sale_confirmation_pending", "sold_confirmation_sending", "sold_awaiting_whatsapp_confirm", "sold_confirmation_failed", "onboarding_payment_pending", "onboarding_created", "onboarding_link_sent", "onboarding_link_failed", "payment_failed", "paid", "manual_consent_pending", "manual_consent_template_failed", "manual_awaiting_whatsapp_confirm", "retention_confirmed"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        loadWorkspaceOperations(workspaceId),
        supabaseAdmin.from("workspace_integrations").select("enabled, connection_status").eq("workspace_id", workspaceId).eq("provider", "twilio_sms").maybeSingle(),
        loadWorkspacePublicBranding(workspaceId, workspaceName),
        loadWorkspaceClientBrandAssets(workspaceId),
        currentRelationshipWork({ workspaceId, relationshipId: relationship.id, userId, isManager: true }),
    ])
    if (servicesResult.error) throw new Error(servicesResult.error.message)
    const storedServices = servicesResult.data ?? []
    const [agencyLogoSrc, previewModules, serviceRevisions] = await Promise.all([
        brandAssets.logoPath ? createPrivateUploadSignedUrl(brandAssets.logoPath) : null,
        Promise.all(onboardingConfiguration.modules.map(async (module) => ({
            ...module,
            steps: await Promise.all(module.steps.map(async (step) => ({
                ...step,
                resolvedVideoUrl: step.videoPath ? await createPrivateUploadSignedUrl(step.videoPath) : step.videoUrl,
                blocks: step.blocks ? await Promise.all(step.blocks.map(async (block) => block.kind === "video" && block.upload?.path
                    ? { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
                    : block)) : undefined,
            }))),
        }))),
        loadOnboardingServiceRevisionDisplays(workspaceId, storedServices.map((service) => service.service_revision_id)),
    ])
    const members = [...operations.people].sort((left, right) => left.name.localeCompare(right.name))
    const serviceOptions = buildRelationshipDealServiceOptions({
        schemaReady: onboardingConfiguration.schemaReady,
        services: onboardingConfiguration.services,
        selected: storedServices,
        revisions: serviceRevisions,
    })
    const dealServices = serviceOptions.map((service) => {
        const configured = onboardingConfiguration.services.find((candidate) => candidate.id === service.serviceId || candidate.code === service.code)
        return {
            code: service.code,
            serviceId: service.serviceId,
            revisionId: service.revisionId,
            name: service.name,
            description: service.description,
            serviceType: service.serviceType,
            recurringName: service.recurringName,
            recurringDescription: service.recurringDescription,
            defaultBillingInterval: service.defaultBillingInterval,
            defaultBillingIntervalCount: service.defaultBillingIntervalCount,
            thumbnailUrl: service.thumbnailUrl,
            defaultUpfrontPriceCents: service.defaultUpfrontPriceCents,
            defaultRecurringPriceCents: service.defaultRecurringPriceCents,
            currency: service.currency,
            isTest: service.isTest,
            revisionNumber: service.revisionNumber,
            selected: Boolean(service.selected),
            selectedUpfrontPriceCents: Number(service.selected?.upfront_price_cents ?? service.defaultUpfrontPriceCents),
            selectedRecurringPriceCents: Number(service.selected?.recurring_price_cents ?? service.defaultRecurringPriceCents),
            selectedCurrency: String(service.selected?.currency ?? service.currency).toUpperCase(),
            selectedAssigneeId: service.selected?.assignee_user_id ?? null,
            moduleIds: configured?.modules.map((module) => module.moduleId) ?? [],
        }
    })


    return {
        backgroundCommandsEnabled: workspacePerformanceEnabled(workspaceId, userId, process.env.WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS, process.env.WORKSPACE_PERFORMANCE_USERS),
        workspaceSlug: workspaceSlug,
        workspaceName: publicBranding.displayName,
        logoSrc: agencyLogoSrc,
        privacyPolicyUrl: publicBranding.privacyPolicyUrl,
        termsOfServiceUrl: publicBranding.termsOfServiceUrl,
        relationshipId: relationship.id,
        userId: userId,
        updatedAt: relationship.updated_at,
        details: {
            primaryPersonName: relationship.primary_person_name,
            businessName: relationship.business_name ?? "",
            primaryContactRole: relationship.primary_contact_role ?? "",
            primaryPhone: relationship.primary_phone ?? "",
            whatsappPhone: relationship.whatsapp_phone ?? "",
            communicationPrimaryProvider: relationship.communication_primary_provider,
            communicationDeliveryMode: relationship.communication_delivery_mode,
            primaryEmail: relationship.primary_email ?? "",
            sellerUserId: relationship.seller_user_id ?? "",
            fulfilmentManagerUserId: relationship.fulfilment_manager_user_id ?? "",
            fulfilmentTeamId: relationship.fulfilment_team_id ?? "",
            projectTimeframeDays: relationship.project_timeframe_days,
            description: relationship.notes_summary ?? "",
            lifecyclePhase: relationship.lifecycle_phase,
        },
        members: members.map((member) => ({ id: member.id, name: member.name, avatarSrc: member.avatarSrc })),
        managers: members.filter((person) => person.canManage).map((person) => ({ id: person.id, name: person.name, avatarSrc: person.avatarSrc })),
        eligibleUsers: Object.fromEntries(operations.services.map((service) => [service.id, operations.eligible.filter((e) => e.service_id === service.id).map((e) => e.user_id)])),
        canSell: Boolean(operations.people.find((p) => p.id === userId)?.canSell) && (!relationship.pos_started_at || relationship.seller_user_id === userId),
        services: dealServices,
        modules: previewModules,
        payment: onboardingConfiguration.payment,
        theme: onboardingConfiguration.theme,
        help: onboardingConfiguration.help,
        schemaReady: onboardingConfiguration.schemaReady,
        whatsappVerified: onboardingConfiguration.help.whatsappVerified,
        twilioVerified: Boolean(twilioConnectionResult.data?.enabled && twilioConnectionResult.data.connection_status === "connected"),
        commercialLocked: Boolean(currentSaleResult.data || relationship.team_locked_at),
        canEdit: role === "owner" || role === "admin" || relationship.seller_user_id === userId || relationship.fulfilment_manager_user_id === userId || (!relationship.pos_started_at && Boolean(operations.people.find((p) => p.id === userId)?.canSell)),
        currentWork: currentWork
    }
}
