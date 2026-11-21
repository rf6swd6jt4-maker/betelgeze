import "server-only"

// The data behind a client's onboarding record, as staff see it: the session, its steps, what the client submitted
// and the access scoping that decides how much of it one person may see. Moved, unchanged, from the onboarding record
// page so that page and the client page's Onboarding tab (GET .../relationships/<id>/onboarding) read the same thing
// through the same checks. Do not loosen a filter here without checking both callers.
import { notFound } from "next/navigation"
import { getOnboardingForm } from "@/lib/onboarding/forms"
import { getOnboardingStepsForModules, type CanonicalSessionStep } from "@/lib/onboarding/canonical-helpers"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { getRelationship } from "@/lib/relationships"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadNormalizedSessionSnapshot } from "@/lib/onboarding/session-snapshot"
import { getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { formatCalendarResponse } from "@/lib/onboarding/calendar"
import { formatAppointmentOnboardingResponse } from "@/lib/appointment-setting"

export type WorkItemRow = {
    id: string
    title: string
    description: string | null
    status: string
    sort_order: number | null
    metadata: Record<string, unknown> | null
    updated_at: string | null
    created_at: string
}

export type AssetRow = {
    id: string
    title: string
    asset_kind: string | null
    native_kind: string | null
    metadata: Record<string, unknown> | null
    content_type: string | null
    file_size: number | null
    updated_at: string | null
    created_at: string
}

export type BlockRequirementRow = {
    session_step_id: string
    session_block_id: string
    requirement_kind: "calendar_scheduled" | "appointment_medium_configured" | "appointment_fields_configured" | "crm_setup_completed"
    response: unknown
    satisfied_at: string
}

export type StepStatus = "not_submitted" | "submitted" | "reviewed" | "waiting" | "blocked" | "canceled"

export type OnboardingStepDetail = {
    key: string
    index: number
    anchorId: string
    title: string
    description: string
    moduleTitle: string
    kind: CanonicalSessionStep["kind"]
    formKey?: string
    fieldLabels: Record<string, string>
    editRequested: boolean
    item: WorkItemRow | null
    submission: AssetRow | null
    uploads: AssetRow[]
    blockAnswers: Array<{ key: string; label: string; value: unknown }>
    status: StepStatus
    updatedAt: string | null
}

export type TimelineItem =
    | { kind: "start"; label: string; done: boolean; href?: string }
    | { kind: "step"; step: OnboardingStepDetail; visibleNumber: number; current: boolean }
    | { kind: "final"; label: string; done: boolean; href?: string }

export function metadataValue(metadata: unknown, key: string) {
    return metadata && typeof metadata === "object" && key in metadata
        ? String((metadata as Record<string, unknown>)[key] ?? "")
        : ""
}

export function metadataRecord(metadata: unknown) {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {}
}

export function slugAnchor(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step"
}

export function formatFieldLabel(key: string, formKey?: string) {
    const form = getOnboardingForm(formKey)
    return form?.fields.find((field) => field.name === key)?.label ?? key.replace(/_/g, " ")
}

export function responseEntries(submission: AssetRow | null, fieldLabels: Record<string, string>, formKey?: string) {
    const response = metadataRecord(submission?.metadata).response
    if (!response || typeof response !== "object" || Array.isArray(response)) return []
    return Object.entries(response as Record<string, unknown>).map(([key, value]) => ({
        key,
        label: fieldLabels[key] ?? formatFieldLabel(key, formKey),
        value,
    }))
}

export function formatFileSize(size: number | null) {
    if (!size) return "Unknown size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function statusForStep(item: WorkItemRow | null, submission: AssetRow | null) {
    const reviewed = Boolean(metadataRecord(item?.metadata).reviewed_at || metadataRecord(submission?.metadata).reviewed_at)
    if (reviewed) return "reviewed"
    if (item?.status === "blocked") return "blocked"
    if (item?.status === "waiting") return "waiting"
    if (item?.status === "canceled") return "canceled"
    if (item?.status === "done" || submission) return "submitted"
    return "not_submitted"
}

export function statusLabel(status: StepStatus) {
    if (status === "not_submitted") return "Not submitted"
    if (status === "submitted") return "Submitted"
    if (status === "reviewed") return "Reviewed"
    return status.replace(/_/g, " ")
}

export function statusTone(status: StepStatus) {
    if (status === "reviewed") return "border-green-400/40 bg-green-950/30 text-green-100"
    if (status === "submitted") return "border-sky-400/40 bg-sky-950/30 text-sky-100"
    if (status === "blocked") return "border-red-500/30 bg-red-950/20 text-red-100"
    if (status === "canceled") return "border-neutral-700 bg-neutral-900 text-neutral-500"
    if (status === "waiting") return "border-amber-500/30 bg-amber-950/20 text-amber-100"
    return "border-neutral-700 bg-neutral-900 text-neutral-300"
}

export type StaffSessionStep = CanonicalSessionStep & {
    sessionStepId?: string | null
    fieldLabels?: Record<string, string>
    blockLabels?: Record<string, string>
    blockOptions?: Record<string, string[]>
}

export function buildStepDetails(
    steps: StaffSessionStep[],
    workItems: WorkItemRow[],
    assets: AssetRow[],
    blockRequirements: BlockRequirementRow[],
    editRequestStepIds = new Set<string>(),
) {
    const itemByStep = new Map<string, WorkItemRow>()
    for (const item of workItems) {
        const stepKey = metadataValue(item.metadata, "session_step_id") || metadataValue(item.metadata, "step_key")
        if (stepKey) itemByStep.set(stepKey, item)
    }

    const submissionsByStep = new Map<string, AssetRow>()
    const uploadsByStep = new Map<string, AssetRow[]>()
    for (const asset of assets) {
        const stepKey = metadataValue(asset.metadata, "session_step_id") || metadataValue(asset.metadata, "step_key")
        if (!stepKey) continue
        if (asset.native_kind === "onboarding_form_submission") {
            const existing = submissionsByStep.get(stepKey)
            if (!existing || new Date(asset.updated_at ?? asset.created_at) > new Date(existing.updated_at ?? existing.created_at)) {
                submissionsByStep.set(stepKey, asset)
            }
        }
        if (asset.native_kind === "onboarding_upload") {
            uploadsByStep.set(stepKey, [...(uploadsByStep.get(stepKey) ?? []), asset])
        }
    }

    const blockRequirementsByStep = new Map<string, BlockRequirementRow[]>()
    for (const requirement of blockRequirements) {
        blockRequirementsByStep.set(requirement.session_step_id, [
            ...(blockRequirementsByStep.get(requirement.session_step_id) ?? []),
            requirement,
        ])
    }

    return steps.map((step, index): OnboardingStepDetail => {
        const item = itemByStep.get(step.key) ?? null
        const submission = submissionsByStep.get(step.key) ?? null
        const uploads = uploadsByStep.get(step.key) ?? []
        const blockRequirementsForStep = blockRequirementsByStep.get(step.sessionStepId ?? step.key) ?? []
        const blockAnswers = blockRequirementsForStep.flatMap((requirement) => {
            if (requirement.requirement_kind === "calendar_scheduled") {
                const formatted = formatCalendarResponse(requirement.response)
                return formatted ? [{
                    key: `calendar:${requirement.session_block_id}`,
                    label: step.blockLabels?.[requirement.session_block_id] ?? "Selected date and time",
                    value: formatted,
                }] : []
            }
            if (requirement.requirement_kind === "crm_setup_completed") {
                const response = requirement.response && typeof requirement.response === "object" ? requirement.response as Record<string, unknown> : {}
                return [
                    { key: `crm:${requirement.session_block_id}:highlevel`, label: "Uses HighLevel", value: response.usesGhl === true ? "Yes" : "No" },
                    ...(response.usesGhl === false && typeof response.crmName === "string" ? [{ key: `crm:${requirement.session_block_id}:name`, label: "Current CRM", value: response.crmName }] : []),
                ]
            }
            return formatAppointmentOnboardingResponse({
                kind: requirement.requirement_kind,
                response: requirement.response,
                options: step.blockOptions?.[requirement.session_block_id],
            }).map((answer) => ({
                ...answer,
                key: `appointment:${requirement.session_block_id}:${answer.key}`,
                label: answer.key === "mediums" ? step.blockLabels?.[requirement.session_block_id] ?? answer.label : answer.label,
            }))
        })
        const dates = [item?.updated_at ?? item?.created_at, submission?.updated_at ?? submission?.created_at, ...uploads.map((asset) => asset.updated_at ?? asset.created_at), ...blockRequirementsForStep.map((requirement) => requirement.satisfied_at)].filter(Boolean) as string[]
        const updatedAt = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
        return {
            key: step.key,
            index,
            anchorId: `step-${slugAnchor(step.key)}`,
            title: item?.title ?? step.title,
            description: item?.description ?? step.description,
            moduleTitle: metadataValue(item?.metadata, "module_title") || step.moduleTitle,
            kind: step.kind,
            formKey: step.formKey,
            fieldLabels: step.fieldLabels ?? {},
            editRequested: Boolean(step.sessionStepId && editRequestStepIds.has(step.sessionStepId)),
            item,
            submission,
            uploads,
            blockAnswers,
            status: statusForStep(item, submission),
            updatedAt,
        }
    })
}

export function computeTimeline(steps: OnboardingStepDetail[], sessionStarted: boolean, sessionCompleted: boolean): TimelineItem[] {
    if (steps.length === 0) {
        return [
            { kind: "start", label: "Start", done: sessionStarted },
            { kind: "final", label: "Finish", done: sessionCompleted },
        ]
    }

    const currentStepIndex = steps.findIndex((step) => step.status === "not_submitted" || step.status === "blocked" || step.status === "waiting")
    const timeline: TimelineItem[] = [{ kind: "start", label: "Start", done: sessionStarted, href: steps[0] ? `#${steps[0].anchorId}` : undefined }]
    for (const step of steps) {
        timeline.push({ kind: "step", step, visibleNumber: step.index + 1, current: step.index === currentStepIndex })
    }
    timeline.push({ kind: "final", label: "Finish", done: sessionCompleted, href: sessionCompleted && steps.length ? `#${steps[steps.length - 1].anchorId}` : undefined })
    return timeline
}

export type OnboardingRelationship = NonNullable<Awaited<ReturnType<typeof getRelationship>>>

export function startOnboardingDetailData(input: {
    sessionId?: string
    userId: string
    workspaceId: string
    workspaceSlug: string
    customOnboardingDomain: string | null
    customOnboardingDomainVerified: boolean
    relationship: OnboardingRelationship
    role: string
    allowedServiceIds: string[]
    canOpenCompleteClientSession: boolean
}) {
    let sessionQuery = supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationship.id)
        .in("status", ["active", "completed", "archived"])
        .order("updated_at", { ascending: false })
        .limit(1)
    if (input.sessionId) sessionQuery = sessionQuery.eq("id", input.sessionId)
    const sessionResultPromise = Promise.resolve(sessionQuery.maybeSingle()).then((result) => {
        if (result.error) throw new Error("Could not load this onboarding session.")
        if (input.sessionId && !result.data) notFound()
        return result
    })
    const modulesResultPromise = Promise.resolve(supabaseAdmin
        .from("relationship_onboarding_modules")
        .select("module_key")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationship.id)
        .order("created_at", { ascending: true }))
    const servicesResultPromise = Promise.resolve(supabaseAdmin
        .from("relationship_services")
        .select("service_key, service_id, service_revision_id, due_date")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationship.id)
        .order("created_at", { ascending: true }))

    const nativeAccessPromise=sessionResultPromise.then(async ({data:session})=>{
        if(session?.service_scope!=="selected_services")return null
        const result=await supabaseAdmin.rpc("read_selected_service_session_access",{p_workspace_id:input.workspaceId,p_session_ids:[session.id],p_user_id:input.userId})
        if(result.error)throw new Error("Could not verify onboarding access.")
        return result.data as {moduleIds:string[];fullSessionIds:string[];serviceNamesBySession:Record<string,string[]>}
    })
    const normalizedSnapshotPromise = sessionResultPromise.then(({ data: session }) => session ? loadNormalizedSessionSnapshot(session) : null)
    const serviceRevisionsPromise = servicesResultPromise.then(({ data: services }) => {
        const scoped = (services ?? []).filter((service) => input.role !== "staff" || input.allowedServiceIds.includes(service.service_id ?? ""))
        return loadOnboardingServiceRevisionDisplays(input.workspaceId, scoped.map((service) => service.service_revision_id))
    })
    const workItemsPromise = sessionResultPromise.then(async ({ data: session }) => {
        if (!session) return [] as WorkItemRow[]
        const { data } = await supabaseAdmin
            .from("work_items")
            .select("id, title, description, status, sort_order, metadata, updated_at, created_at")
            .eq("workspace_id", input.workspaceId)
            .eq("native_kind", "onboarding_step")
            .like("native_key", `${session.id}:%`)
            .order("sort_order", { ascending: true })
        return (data ?? []) as WorkItemRow[]
    })
    const assetsPromise = sessionResultPromise.then(async ({ data: session }) => {
        if (!session) return [] as AssetRow[]
        const { data } = await supabaseAdmin
            .from("assets")
            .select("id, title, asset_kind, native_kind, metadata, content_type, file_size, updated_at, created_at")
            .eq("workspace_id", input.workspaceId)
            .in("native_kind", ["onboarding_form_submission", "onboarding_upload"])
            .like("native_key", `${session.id}:%`)
            .order("updated_at", { ascending: false })
        return (data ?? []) as AssetRow[]
    })
    const editRequestsPromise = Promise.all([sessionResultPromise, normalizedSnapshotPromise]).then(async ([{ data: session }, normalizedSnapshot]) => {
        if (!session || !normalizedSnapshot) return [] as Array<{ session_step_id: string }>
        const { data } = await supabaseAdmin.from("onboarding_edit_requests").select("session_step_id").eq("workspace_id", input.workspaceId).eq("session_id", session.id).eq("status", "pending")
        return (data ?? []) as Array<{ session_step_id: string }>
    })
    const blockRequirementsPromise = Promise.all([sessionResultPromise, normalizedSnapshotPromise]).then(async ([{ data: session }, normalizedSnapshot]) => {
        if (!session || !normalizedSnapshot) return [] as BlockRequirementRow[]
        const { data } = await supabaseAdmin.from("onboarding_block_requirements")
            .select("session_step_id, session_block_id, requirement_kind, response, satisfied_at")
            .eq("workspace_id", input.workspaceId)
            .eq("session_id", session.id)
            .in("requirement_kind", ["calendar_scheduled", "appointment_medium_configured", "appointment_fields_configured", "crm_setup_completed"])
        return (data ?? []) as BlockRequirementRow[]
    })

    const summaryPromise = Promise.all([
        sessionResultPromise,
        modulesResultPromise,
        servicesResultPromise,
        serviceRevisionsPromise,
        normalizedSnapshotPromise, nativeAccessPromise,
    ]).then(([{ data: session }, { data: modules }, { data: services }, serviceRevisions, normalizedSnapshot, nativeAccess]) => {
        if (nativeAccess && !nativeAccess.moduleIds.length && !nativeAccess.fullSessionIds.includes(session?.id ?? "")) notFound()
        const scopedServices = (services ?? []).filter((service) => input.role !== "staff" || input.allowedServiceIds.includes(service.service_id ?? ""))
        const moduleKeys = (modules ?? []).map((module) => module.module_key).filter((key): key is string => Boolean(key))
        const scopedServiceRevisionIds = new Set(scopedServices.map((service) => service.service_revision_id).filter((id): id is string => Boolean(id)))
        const scopedSnapshotModules = (normalizedSnapshot?.modules ?? []).filter((module) => (
            nativeAccess ? nativeAccess.moduleIds.includes(module.id) : input.role !== "staff"
            || module.sourceKind === "mandatory"
            || Boolean(module.sourceServiceRevisionId && scopedServiceRevisionIds.has(module.sourceServiceRevisionId))
        ))
        const scopedSnapshotModuleIds = new Set(scopedSnapshotModules.map((module) => module.id))
        const scopedSnapshotSteps = (normalizedSnapshot?.actionableSteps ?? []).filter((step) => (
            input.role !== "staff"
            || !step.sessionModuleId
            || scopedSnapshotModuleIds.has(step.sessionModuleId)
        ))
        const canonicalSteps: StaffSessionStep[] = normalizedSnapshot
            ? scopedSnapshotSteps.map((step) => ({
                key: step.id,
                sessionStepId: step.id,
                title: step.title,
                description: step.description,
                moduleTitle: step.moduleTitle,
                estimatedTime: step.estimatedTime,
                why: step.why,
                kind: step.kind === "completion" ? "final" : step.kind === "welcome" ? "video" : step.kind,
                formKey: step.legacyFormKey ?? undefined,
                videoUrl: step.videoUrl,
                fieldLabels: Object.fromEntries(step.fields.map((field) => [field.id, field.label])),
                blockLabels: Object.fromEntries(step.blocks.flatMap((block) => block.kind === "calendar"
                    || block.kind === "appointment_medium"
                    || block.kind === "appointment_fields"
                    ? [[block.sessionBlockId ?? block.id, block.title]]
                    : [])),
                blockOptions: Object.fromEntries(step.blocks.flatMap((block) => block.kind === "appointment_medium" || block.kind === "appointment_fields"
                    ? [[block.sessionBlockId ?? block.id, block.options]]
                    : [])),
            }))
            : session ? getOnboardingStepsForModules(moduleKeys) : []

        return {
            session,
            modules: modules ?? [],
            serviceRevisions,
            normalizedSnapshot,
            scopedServices,
            nativeServiceNames: nativeAccess?.serviceNamesBySession[session?.id ?? ""],
            scopedSnapshotModules,
            canonicalSteps,
            sessionCompleted: session?.status === "completed",
            isTest: Boolean(session?.is_test) || input.relationship.source_metadata.is_test === true,
            canManage: input.role === "owner" || input.role === "admin",
            canOpenCompleteClientSession: nativeAccess ? nativeAccess.fullSessionIds.includes(session?.id ?? "") : input.canOpenCompleteClientSession,
            onboardingUrl: session ? getOnboardingUrl(input.workspaceSlug, session.session_token, input.customOnboardingDomain, input.customOnboardingDomainVerified) : null,
        }
    })

    const activityPromise = Promise.all([
        summaryPromise,
        workItemsPromise,
        assetsPromise,
        editRequestsPromise,
        blockRequirementsPromise,
    ]).then(([summary, workItems, assets, editRequests, blockRequirements]) => {
        const scopedStepIds = new Set(summary.canonicalSteps.map((step) => step.sessionStepId ?? step.key))
        const scopedWorkItems = workItems.filter((item) => input.role !== "staff" || scopedStepIds.has(metadataValue(item.metadata, "session_step_id") || metadataValue(item.metadata, "step_key")))
        const scopedAssets = assets.filter((asset) => input.role !== "staff" || scopedStepIds.has(metadataValue(asset.metadata, "session_step_id") || metadataValue(asset.metadata, "step_key")))
        const scopedEditRequests = editRequests.filter((request) => input.role !== "staff" || scopedStepIds.has(request.session_step_id))
        const scopedBlockRequirements = blockRequirements.filter((requirement) => input.role !== "staff" || scopedStepIds.has(requirement.session_step_id)) as BlockRequirementRow[]
        const steps = buildStepDetails(summary.canonicalSteps, scopedWorkItems, scopedAssets, scopedBlockRequirements, new Set(scopedEditRequests.map((request) => request.session_step_id)))
        const percentage = getProgressPercentage(steps.map((step) => ({ key: step.key })), steps.filter((step) => step.status === "submitted" || step.status === "reviewed").map((step) => step.key))
        const latestActivity = [
            summary.session?.updated_at,
            ...scopedWorkItems.map((item) => item.updated_at ?? item.created_at),
            ...scopedAssets.map((asset) => asset.updated_at ?? asset.created_at),
            ...scopedBlockRequirements.map((requirement) => requirement.satisfied_at),
        ].filter((value): value is string => Boolean(value)).reduce<string | null>((latest, value) => !latest || new Date(value) > new Date(latest) ? value : latest, null)
        return {
            ...summary,
            assets,
            scopedAssets,
            steps,
            percentage,
            latestActivity,
            sessionStuck: summary.session ? isOnboardingStuck({ percentage, createdAt: summary.session.created_at, lastActivityAt: latestActivity }) : false,
            timeline: computeTimeline(steps, Boolean(summary.session), summary.sessionCompleted),
        }
    })

    return { summaryPromise, activityPromise }
}

export type OnboardingDetailData = ReturnType<typeof startOnboardingDetailData>
