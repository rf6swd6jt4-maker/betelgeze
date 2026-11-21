import { loadOnboardingSessionPage } from "@/lib/onboarding/session-access"
import { MODULES } from "@/lib/onboarding/modules"
import { relationshipServiceDisplayName } from "@/lib/onboarding/service-display"
import { formatFileSize, metadataValue, responseEntries, startOnboardingDetailData, statusLabel, type AssetRow } from "@/lib/onboarding/staff-detail"
import { onboardingAnswerText, type ClientOnboarding, type ClientOnboardingRecord, type ClientOnboardingUpload } from "@/lib/onboarding/staff-detail-view"
import { getRelationship } from "@/lib/relationships"
import { accessibleRelationshipIds, fullyAccessibleRelationshipIds, requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

/**
 * The Onboarding section of one client's page (Today layout). Read-only. It follows the onboarding record page step
 * for step: the same panel check, the same relationship checks, the same list of sessions the person may open, and
 * the same access-scoped loader (startOnboardingDetailData), then reduces the result to what the tab shows. With one
 * session it returns that record; with several it returns the list and, when `?session=` names one of them, its
 * record. No link token, upload or answer is returned that the record page would not show this person.
 */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const requested = new URL(request.url).searchParams.get("session")
    if (!uuid.test(relationshipId) || (requested !== null && !uuid.test(requested))) return Response.json({ error: "Invalid client." }, { status: 400, headers })
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "onboarding")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    const [relationship, allowedRelationshipIds, fullyAllowedRelationshipIds, listed] = await Promise.all([
        getRelationship(workspace.id, relationshipId),
        accessibleRelationshipIds(access),
        fullyAccessibleRelationshipIds(access),
        loadOnboardingSessionPage(workspace.id, user.id, 0, relationshipId),
    ])
    if (!relationship || (allowedRelationshipIds && !allowedRelationshipIds.has(relationshipId))) return Response.json({ error: "Client not found." }, { status: 404, headers })

    const sessions = listed.sessions.map(session => ({ id: session.id, status: session.status, isTest: session.is_test, createdAt: session.created_at, completedAt: session.completed_at }))
    // The record page opens a lone session directly and otherwise asks which one; a named session must be one the list offers.
    const sessionId = requested ?? (sessions.length === 1 && !listed.hasMore ? sessions[0].id : null)
    if (requested && !listed.hasMore && !sessions.some(session => session.id === requested)) return Response.json({ error: "Onboarding session not found." }, { status: 404, headers })
    const base: ClientOnboarding = { userId: user.id, relationshipId, sessions, record: null }
    if (!sessionId) return Response.json(base, { headers })

    const data = startOnboardingDetailData({
        sessionId,
        userId: user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        customOnboardingDomain: workspace.custom_onboarding_domain,
        customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
        relationship,
        role,
        allowedServiceIds: access.allowedServiceIds,
        canOpenCompleteClientSession: !fullyAllowedRelationshipIds || fullyAllowedRelationshipIds.has(relationship.id),
    })
    const [summary, activity] = await Promise.all([data.summaryPromise, data.activityPromise])
    const session = activity.session
    if (!session) return Response.json(base, { headers })

    const upload = (asset: AssetRow): ClientOnboardingUpload => ({ id: asset.id, title: asset.title, kind: asset.content_type ?? asset.asset_kind ?? "Asset", size: formatFileSize(asset.file_size) })
    // The record page shows the link to a manager of a live session (who may replace or revoke it), and otherwise only
    // while it is not revoked and the person may open the complete client session.
    const mayCopy = Boolean(activity.onboardingUrl) && ((session.status !== "archived" && activity.canManage) || (!session.token_revoked_at && activity.canOpenCompleteClientSession))
    const record: ClientOnboardingRecord = {
        sessionId: session.id, status: session.status, completed: activity.sessionCompleted, isTest: activity.isTest, stuck: activity.sessionStuck,
        percentage: activity.percentage, total: activity.steps.length, done: activity.steps.filter(step => step.status === "submitted" || step.status === "reviewed").length,
        latestActivity: activity.latestActivity,
        services: summary.nativeServiceNames ?? summary.scopedServices.map(service => relationshipServiceDisplayName(service, summary.serviceRevisions)),
        modules: [
            ...summary.scopedSnapshotModules.map(module => module.title),
            ...(!summary.normalizedSnapshot ? summary.modules.map(module => MODULES[module.module_key]?.title ?? module.module_key) : []),
        ],
        // The link itself only where the record page would show or manage it for this person.
        link: { path: mayCopy ? activity.onboardingUrl : null, revoked: Boolean(session.token_revoked_at), tokenVersion: Number(session.token_version) || 1,
            canManage: activity.canManage, canOpenComplete: activity.canOpenCompleteClientSession, archived: session.status === "archived" },
        steps: activity.steps.map(step => {
            const byField = new Map<string, ClientOnboardingUpload[]>(), loose: ClientOnboardingUpload[] = []
            for (const asset of step.uploads) {
                const field = metadataValue(asset.metadata, "field_name")
                if (field) byField.set(field, [...(byField.get(field) ?? []), upload(asset)])
                else loose.push(upload(asset))
            }
            return {
                key: step.key, number: step.index + 1, title: step.title, moduleTitle: step.moduleTitle, status: step.status, statusLabel: statusLabel(step.status),
                updatedAt: step.updatedAt, editRequested: step.editRequested, instruction: step.kind === "video", taskId: step.item?.id ?? null,
                answers: [...responseEntries(step.submission, step.fieldLabels, step.formKey), ...step.blockAnswers].map(answer => ({ key: answer.key, label: answer.label, value: onboardingAnswerText(answer.value), uploads: byField.get(answer.key) ?? [] })),
                uploads: loose,
            }
        }),
    }
    return Response.json({ ...base, record } satisfies ClientOnboarding, { headers })
}
