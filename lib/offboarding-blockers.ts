import { supabaseAdmin } from "@/lib/supabase/admin"
import { offboardingBlockerMessage, type OffboardingBlocker } from "@/lib/offboarding-blocker-message"

// Runs only after a database offboarding guard has already refused a change, so
// it adds no work to the normal save path. Every read is bounded.
const ACTIVE_QUEUE_STAGES = ["onboarding", "setup", "maintenance"]
const LIMIT = 50

type RelationshipLabel = { id: string; primary_person_name: string | null; business_name: string | null }

function clientLabel(relationship: RelationshipLabel | undefined) {
    return relationship?.business_name?.trim() || relationship?.primary_person_name?.trim() || "an unnamed client"
}

async function relationshipLabels(workspaceId: string, ids: string[], activeTeamOnly: boolean) {
    const labels = new Map<string, RelationshipLabel>()
    if (!ids.length) return labels
    let query = supabaseAdmin.from("relationships").select("id, primary_person_name, business_name").eq("workspace_id", workspaceId).in("id", ids).neq("status", "archived")
    if (activeTeamOnly) query = query.not("team_locked_at", "is", null).neq("lifecycle_phase", "completed_lost")
    const { data } = await query.limit(LIMIT)
    for (const row of (data ?? []) as RelationshipLabel[]) labels.set(row.id, row)
    return labels
}

export async function personLabel(userId: string) {
    const [{ data: profile }, { data: auth }] = await Promise.all([
        supabaseAdmin.from("user_profiles").select("display_name, username").eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
    ])
    return profile?.display_name?.trim() || profile?.username?.trim() || auth.user?.email || "This person"
}

export async function loadOffboardingBlockers(workspaceId: string, userId: string, options: { serviceId?: string } = {}) {
    const blockers: OffboardingBlocker[] = []
    const seen = new Set<string>()
    const add = (client: string, detail: string) => {
        const key = `${client}\u0000${detail}`
        if (!seen.has(key)) { seen.add(key); blockers.push({ client, detail }) }
    }

    if (!options.serviceId) {
        const [{ data: managed }, { data: assigned }] = await Promise.all([
            supabaseAdmin.from("relationships").select("id, primary_person_name, business_name").eq("workspace_id", workspaceId).eq("fulfilment_manager_user_id", userId).neq("status", "archived").neq("lifecycle_phase", "completed_lost").not("team_locked_at", "is", null).limit(LIMIT),
            supabaseAdmin.from("relationship_services").select("relationship_id, service_key").eq("workspace_id", workspaceId).eq("assignee_user_id", userId).limit(LIMIT),
        ])
        for (const row of (managed ?? []) as RelationshipLabel[]) add(clientLabel(row), "fulfilment manager")
        const assignedRows = (assigned ?? []) as { relationship_id: string; service_key: string }[]
        const labels = await relationshipLabels(workspaceId, [...new Set(assignedRows.map((row) => row.relationship_id))], true)
        for (const row of assignedRows) {
            const relationship = labels.get(row.relationship_id)
            if (relationship) add(clientLabel(relationship), `${row.service_key} assignee`)
        }
    }

    const { data: memberRows } = await supabaseAdmin.from("service_queue_members").select("instance_id").eq("workspace_id", workspaceId).eq("user_id", userId).limit(200)
    const instanceIds = ((memberRows ?? []) as { instance_id: string }[]).map((row) => row.instance_id)
    if (instanceIds.length) {
        let instanceQuery = supabaseAdmin.from("relationship_service_instances").select("id, relationship_id, service_id, service_key").eq("workspace_id", workspaceId).in("id", instanceIds).neq("disposition", "cancelled").in("stage", ACTIVE_QUEUE_STAGES)
        if (options.serviceId) instanceQuery = instanceQuery.eq("service_id", options.serviceId)
        const { data: instances } = await instanceQuery.limit(LIMIT)
        const instanceRows = (instances ?? []) as { id: string; relationship_id: string; service_id: string | null; service_key: string }[]
        const [labels, services] = await Promise.all([
            relationshipLabels(workspaceId, [...new Set(instanceRows.map((row) => row.relationship_id))], false),
            (async () => {
                const ids = [...new Set(instanceRows.flatMap((row) => row.service_id ? [row.service_id] : []))]
                if (!ids.length) return new Map<string, string>()
                const { data } = await supabaseAdmin.from("onboarding_services").select("id, name").eq("workspace_id", workspaceId).in("id", ids).limit(LIMIT)
                return new Map(((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]))
            })(),
        ])
        for (const row of instanceRows) {
            const relationship = labels.get(row.relationship_id)
            if (!relationship) continue
            const service = (row.service_id ? services.get(row.service_id) : null) ?? row.service_key
            add(clientLabel(relationship), `${service}, shared service queue`)
        }
    }
    return blockers
}

/** Names what is blocking a full workspace removal; falls back to a generic sentence if lookup fails. */
export async function workspaceRemovalBlockedMessage(workspaceId: string, userId: string) {
    try {
        const [person, blockers] = await Promise.all([personLabel(userId), loadOffboardingBlockers(workspaceId, userId)])
        return offboardingBlockerMessage({ person, blockers })
    } catch (error) {
        console.error("Offboarding blocker lookup failed", { workspaceId, userId, error: error instanceof Error ? error.message : error })
        return null
    }
}

/** Names the people dropped from a service's eligible staff who still have active queue work in it. */
export async function serviceEligibilityBlockedMessage(workspaceId: string, serviceId: string, keptUserIds: string[]) {
    try {
        const kept = new Set(keptUserIds)
        const [{ data: current }, { data: service }] = await Promise.all([
            supabaseAdmin.from("workspace_member_service_access").select("user_id").eq("workspace_id", workspaceId).eq("service_id", serviceId).limit(200),
            supabaseAdmin.from("onboarding_services").select("name").eq("workspace_id", workspaceId).eq("id", serviceId).maybeSingle(),
        ])
        const removed = ((current ?? []) as { user_id: string }[]).map((row) => row.user_id).filter((id) => !kept.has(id)).slice(0, 5)
        const serviceName = service?.name?.trim() || "this service"
        const messages: string[] = []
        for (const userId of removed) {
            const blockers = await loadOffboardingBlockers(workspaceId, userId, { serviceId })
            if (!blockers.length) continue
            messages.push(offboardingBlockerMessage({ person: await personLabel(userId), blockers, serviceName }))
        }
        return messages.length ? messages.join(" ") : null
    } catch (error) {
        console.error("Service eligibility blocker lookup failed", { workspaceId, serviceId, error: error instanceof Error ? error.message : error })
        return null
    }
}
