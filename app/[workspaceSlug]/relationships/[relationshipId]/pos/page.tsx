import Link from "next/link"
import { workspacePerformanceEnabled } from "@/lib/workspace-native"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailFieldsLoading, DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    fulfilmentDetailHref,
    getRelationship,
    onboardingDetailHref,
    type RelationshipRecord,
} from "@/lib/relationships"
import { effectiveGanttRanges, getRelationshipGanttPlan, type RelationshipGanttPlan } from "@/lib/relationship-gantt"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel, requireRelationshipAccess } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { buildRelationshipDealServiceOptions } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { currentRelationshipWork } from "@/lib/relationship-workflow"
import { archiveRelationship } from "../../actions"
import { ArchiveRelationshipForm } from "../ArchiveRelationshipForm"
import { RetentionCommunicationsSetup } from "@/components/relationships/RetentionCommunicationsSetup"
import { RelationshipDealWorkspace } from "../RelationshipDealWorkspace"
import { loadWorkspaceOperations } from "@/lib/teams/operations"
import { loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"
import { loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

async function RelationshipPlanFact({ planPromise, kind }: { planPromise: Promise<RelationshipGanttPlan>; kind: "open" | "unscheduled" }) {
    const plan = await planPromise
    if (kind === "open") return plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length
    const ranges = effectiveGanttRanges(plan.items)
    return plan.items.filter((item) => !ranges.has(item.id)).length
}

async function RelationshipWorkspace({ workspaceId, workspaceSlug, workspaceName, userId, role, relationship, planPromise }: {
    workspaceId: string
    workspaceSlug: string
    workspaceName: string
    userId: string
    role: string
    relationship: RelationshipRecord
    planPromise: Promise<RelationshipGanttPlan>
}) {
    const [servicesResult, onboardingConfiguration, currentSaleResult, operations, twilioConnectionResult, publicBranding, brandAssets, currentWork, nativeServices] = await Promise.all([
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
        supabaseAdmin.from("relationship_service_instances").select("id").eq("workspace_id", workspaceId).eq("relationship_id", relationship.id).is("import_id", null).limit(1),
    ])
    if (nativeServices.error) throw new Error("Could not verify the relationship sales flow")
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

    return <>
        {relationship.lifecycle_phase === "retention" && ["creator_dm", "messaging_confirmation"].includes(String(relationship.source_metadata.portal_handoff)) ? <RetentionCommunicationsSetup manualHandoff={relationship.source_metadata.portal_handoff === "creator_dm"} workspaceSlug={workspaceSlug} relationshipId={relationship.id} pending={relationship.source_metadata.external_messaging_pending === true} canRequest={role === "owner" || role === "admin" || relationship.seller_user_id === userId} provider={relationship.communication_primary_provider} /> : null}
        <RelationshipDealWorkspace
        backgroundCommandsEnabled={workspacePerformanceEnabled(workspaceId, userId, process.env.WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS, process.env.WORKSPACE_PERFORMANCE_USERS)}
        workspaceSlug={workspaceSlug}
        workspaceName={publicBranding.displayName}
        logoSrc={agencyLogoSrc}
        privacyPolicyUrl={publicBranding.privacyPolicyUrl}
        termsOfServiceUrl={publicBranding.termsOfServiceUrl}
        relationshipId={relationship.id}
        userId={userId}
        updatedAt={relationship.updated_at}
        details={{
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
        }}
        members={members.map((member) => ({ id: member.id, name: member.name, avatarSrc: member.avatarSrc }))}
        managers={members.filter((person) => person.canManage).map((person) => ({ id: person.id, name: person.name, avatarSrc: person.avatarSrc }))}
        eligibleUsers={Object.fromEntries(operations.services.map((service) => [service.id, operations.eligible.filter((e) => e.service_id === service.id).map((e) => e.user_id)]))}
        canSell={!nativeServices.data?.length && Boolean(operations.people.find((p) => p.id === userId)?.canSell) && (!relationship.pos_started_at || relationship.seller_user_id === userId)}
        services={dealServices}
        modules={previewModules}
        payment={onboardingConfiguration.payment}
        theme={onboardingConfiguration.theme}
        help={onboardingConfiguration.help}
        schemaReady={onboardingConfiguration.schemaReady}
        whatsappVerified={onboardingConfiguration.help.whatsappVerified}
        twilioVerified={Boolean(twilioConnectionResult.data?.enabled && twilioConnectionResult.data.connection_status === "connected")}
        commercialLocked={Boolean(currentSaleResult.data || relationship.team_locked_at)}
        planPromise={planPromise}
        canEdit={role === "owner" || role === "admin" || relationship.seller_user_id === userId || relationship.fulfilment_manager_user_id === userId || (!relationship.pos_started_at && Boolean(operations.people.find((p) => p.id === userId)?.canSell))}
        currentWork={currentWork}
    /></>
}

export default async function RelationshipDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    // Detail reads stay pure. Workflow stages are created and repaired by their
    // mutation/migration paths, so opening a record never writes and refetches
    // the same Gantt before it can render.
    const planPromise = getRelationshipGanttPlan(workspace.slug, relationship)
    const isOnboarding = ["onboarding", "onboarding_review"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                    <DetailPageHeader
                        category="Relationship"
                        reference={shortId(relationship.id)}
                        title={relationship.primary_person_name}
                        subtitle={relationship.business_name ?? "No company saved"}
                        labels={<>{relationship.source_metadata.is_test === true ? <SquarePill tone="yellow">Test</SquarePill> : null}<RelationshipStage phase={relationship.lifecycle_phase} /></>}
                        facts={[
                            { label: "open", value: <Suspense fallback="—"><RelationshipPlanFact planPromise={planPromise} kind="open" /></Suspense> },
                            { label: "unscheduled", value: <Suspense fallback="—"><RelationshipPlanFact planPromise={planPromise} kind="unscheduled" /></Suspense> },
                        ]}
                        updated={formatRelativeTime(relationship.updated_at)}
                    />

                    <Suspense fallback={<DetailFieldsLoading label="Loading relationship details" rows={8} />}>
                        <RelationshipWorkspace workspaceId={workspace.id} workspaceSlug={workspace.slug} workspaceName={workspace.name} userId={user.id} role={role} relationship={relationship} planPromise={planPromise} />
                    </Suspense>

                    <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                        {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                        {isFulfilment && <Link href={fulfilmentDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open fulfilment detail</Link>}
                    </section>

                    {(role === "owner" || role === "admin") ? <DetailDangerZone>
                        <DetailDangerAction
                            title="Archive relationship"
                            description="Removes it from active relationship lists and WhatsApp confirmation matching while preserving its billing records, messages, and other history."
                            control={<ArchiveRelationshipForm action={archiveRelationship.bind(null, workspace.slug, relationship.id)} relationshipName={relationship.business_name ?? relationship.primary_person_name} />}
                        />
                        <DetailDangerAction
                            title="Delete relationship permanently"
                            description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented."
                            control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
                        />
                    </DetailDangerZone> : null}
                </div>

                <ClientContextPanel access={access} workspaceSlug={workspace.slug} relationship={relationship} />
            </div>
        </div>
    </main>
}
