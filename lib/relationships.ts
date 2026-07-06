import { supabaseAdmin } from "@/lib/supabase/admin"

export const RELATIONSHIP_PHASES = [
    { key: "found", label: "Found" },
    { key: "qualified", label: "Qualified" },
    { key: "contacted", label: "Contacted" },
    { key: "sold", label: "Sold" },
    { key: "invoiced", label: "Invoiced" },
    { key: "onboarding", label: "Onboarding" },
    { key: "onboarding_complete", label: "Onboarding Complete" },
    { key: "fulfilment", label: "Fulfilment" },
    { key: "retention", label: "Retention" },
    { key: "completed_lost", label: "Completed/Lost" },
] as const

export type RelationshipPhase = (typeof RELATIONSHIP_PHASES)[number]["key"]
export type RelationshipStatus = "active" | "waiting" | "blocked" | "completed" | "lost" | "archived"
export type RelationshipWorkItemStatus = "todo" | "doing" | "waiting" | "blocked" | "done" | "canceled"

export type RelationshipRecord = {
    id: string
    workspace_id: string
    client_id: string | null
    leadgen_company_id: string | null
    source_type: "manual" | "client" | "leadgen"
    primary_person_name: string
    primary_email: string | null
    primary_phone: string | null
    business_name: string | null
    website_url: string | null
    lifecycle_phase: RelationshipPhase
    status: RelationshipStatus
    source_metadata: Record<string, unknown>
    created_at: string
    updated_at: string
    fallback?: boolean
}

export type RelationshipWorkItem = {
    id: string
    workspace_id: string
    relationship_id: string
    title: string
    description: string | null
    lifecycle_phase: RelationshipPhase
    status: RelationshipWorkItemStatus
    priority: number
    is_key_task: boolean
    native_kind: string | null
    native_id: string | null
    native_href: string | null
    planned_start_date: string | null
    planned_end_date: string | null
    actual_start_at: string | null
    actual_completed_at: string | null
    sort_order: number
    metadata: Record<string, unknown>
    created_at: string
    updated_at: string
    synthesized?: boolean
}

export type WorkQueueItem = RelationshipWorkItem & {
    relationship: Pick<RelationshipRecord, "id" | "primary_person_name" | "business_name" | "client_id">
}

type QueryError = { message?: string; code?: string } | null | undefined
type ClientRow = {
    id: string
    workspace_id: string
    name: string | null
    email: string | null
    phone?: string | null
    created_at: string
    archived_at?: string | null
    is_test?: boolean | null
}

function isMissingRelationshipSchema(error: QueryError) {
    const message = error?.message?.toLowerCase() ?? ""
    return (
        error?.code === "42P01" ||
        message.includes("relationships") && (
            message.includes("does not exist") ||
            message.includes("schema cache") ||
            message.includes("could not find the table")
        )
    )
}

function safePhase(value: unknown, fallback: RelationshipPhase = "found"): RelationshipPhase {
    return RELATIONSHIP_PHASES.some((phase) => phase.key === value)
        ? value as RelationshipPhase
        : fallback
}

function phaseIndex(phase: RelationshipPhase) {
    return RELATIONSHIP_PHASES.findIndex((item) => item.key === phase)
}

export function phaseLabel(phase: RelationshipPhase) {
    return RELATIONSHIP_PHASES.find((item) => item.key === phase)?.label ?? phase
}

export function workspaceHref(workspaceSlug: string, suffix = "") {
    const cleanSuffix = suffix.replace(/^\/+/, "")
    return `/${workspaceSlug}${cleanSuffix ? `/${cleanSuffix}` : ""}`
}

export function relationshipHubHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `relationships/${relationshipId}`)
}

export function clientNativeHref(workspaceSlug: string, clientId: string) {
    return workspaceHref(workspaceSlug, `clients/${clientId}`)
}

function fallbackRelationshipFromClient(client: ClientRow): RelationshipRecord {
    const identity = client.name?.trim() || client.email?.trim() || client.phone?.trim() || "Unknown relationship"
    return {
        id: client.id,
        workspace_id: client.workspace_id,
        client_id: client.id,
        leadgen_company_id: null,
        source_type: "client",
        primary_person_name: identity,
        primary_email: client.email ?? null,
        primary_phone: client.phone ?? null,
        business_name: client.name ?? null,
        website_url: null,
        lifecycle_phase: client.archived_at ? "completed_lost" : "onboarding",
        status: client.archived_at ? "archived" : "active",
        source_metadata: { fallback_from: "clients", is_test: Boolean(client.is_test) },
        created_at: client.created_at,
        updated_at: client.created_at,
        fallback: true,
    }
}

async function listClientFallbackRelationships(workspaceId: string) {
    const { data } = await supabaseAdmin
        .from("clients")
        .select("id, workspace_id, name, email, phone, created_at, archived_at, is_test")
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    return ((data ?? []) as ClientRow[]).map(fallbackRelationshipFromClient)
}

export async function listRelationshipsForWorkspace(workspaceId: string): Promise<RelationshipRecord[]> {
    const [relationshipsResult, clients] = await Promise.all([
        supabaseAdmin
            .from("relationships")
            .select("id, workspace_id, client_id, leadgen_company_id, source_type, primary_person_name, primary_email, primary_phone, business_name, website_url, lifecycle_phase, status, source_metadata, created_at, updated_at")
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false }),
        listClientFallbackRelationships(workspaceId),
    ])

    if (isMissingRelationshipSchema(relationshipsResult.error)) {
        return clients
    }

    const relationships = ((relationshipsResult.data ?? []) as RelationshipRecord[]).map((relationship) => ({
        ...relationship,
        lifecycle_phase: safePhase(relationship.lifecycle_phase),
        source_metadata: relationship.source_metadata ?? {},
    }))
    const wrappedClientIds = new Set(relationships.map((relationship) => relationship.client_id).filter(Boolean))
    const missingClientFallbacks = clients.filter((client) => client.client_id && !wrappedClientIds.has(client.client_id))
    return [...relationships, ...missingClientFallbacks].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
}

export async function getRelationship(workspaceId: string, relationshipId: string): Promise<RelationshipRecord | null> {
    const byId = await supabaseAdmin
        .from("relationships")
        .select("id, workspace_id, client_id, leadgen_company_id, source_type, primary_person_name, primary_email, primary_phone, business_name, website_url, lifecycle_phase, status, source_metadata, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .maybeSingle()

    if (byId.data) {
        const relationship = byId.data as RelationshipRecord
        return { ...relationship, lifecycle_phase: safePhase(relationship.lifecycle_phase), source_metadata: relationship.source_metadata ?? {} }
    }

    if (!isMissingRelationshipSchema(byId.error)) {
        const byClient = await supabaseAdmin
            .from("relationships")
            .select("id, workspace_id, client_id, leadgen_company_id, source_type, primary_person_name, primary_email, primary_phone, business_name, website_url, lifecycle_phase, status, source_metadata, created_at, updated_at")
            .eq("workspace_id", workspaceId)
            .eq("client_id", relationshipId)
            .maybeSingle()

        if (byClient.data) {
            const relationship = byClient.data as RelationshipRecord
            return { ...relationship, lifecycle_phase: safePhase(relationship.lifecycle_phase), source_metadata: relationship.source_metadata ?? {} }
        }
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, workspace_id, name, email, phone, created_at, archived_at, is_test")
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .maybeSingle()

    return client ? fallbackRelationshipFromClient(client as ClientRow) : null
}

export async function getRelationshipHubHrefForClient(workspaceSlug: string, workspaceId: string, clientId: string) {
    const result = await supabaseAdmin
        .from("relationships")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("client_id", clientId)
        .maybeSingle()

    const relationshipId = result.data?.id ?? clientId
    return relationshipHubHref(workspaceSlug, relationshipId)
}

function relationshipNativeHref(workspaceSlug: string, relationship: RelationshipRecord) {
    if (relationship.client_id) return clientNativeHref(workspaceSlug, relationship.client_id)
    if (relationship.leadgen_company_id) return workspaceHref(workspaceSlug, "leadgen")
    return relationshipHubHref(workspaceSlug, relationship.id)
}

function sortWorkItems(left: RelationshipWorkItem, right: RelationshipWorkItem) {
    const phaseDelta = phaseIndex(left.lifecycle_phase) - phaseIndex(right.lifecycle_phase)
    if (phaseDelta !== 0) return phaseDelta
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    const leftTime = left.planned_start_date ?? left.actual_start_at ?? left.created_at
    const rightTime = right.planned_start_date ?? right.actual_start_at ?? right.created_at
    return new Date(leftTime).getTime() - new Date(rightTime).getTime()
}

export async function listRelationshipTimelineItems(workspaceSlug: string, relationship: RelationshipRecord): Promise<RelationshipWorkItem[]> {
    const storedResult = relationship.fallback
        ? { data: null, error: { message: "fallback relationship" } }
        : await supabaseAdmin
            .from("relationship_work_items")
            .select("id, workspace_id, relationship_id, title, description, lifecycle_phase, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, planned_end_date, actual_start_at, actual_completed_at, sort_order, metadata, created_at, updated_at")
            .eq("workspace_id", relationship.workspace_id)
            .eq("relationship_id", relationship.id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })

    const storedItems = isMissingRelationshipSchema(storedResult.error)
        ? []
        : ((storedResult.data ?? []) as RelationshipWorkItem[]).map((item) => ({
            ...item,
            lifecycle_phase: safePhase(item.lifecycle_phase),
            metadata: item.metadata ?? {},
        }))

    const synthesized: RelationshipWorkItem[] = []
    const now = new Date().toISOString()

    if (relationship.source_type === "leadgen" || relationship.leadgen_company_id) {
        synthesized.push({
            id: `leadgen-${relationship.leadgen_company_id ?? relationship.id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
            title: "Qualified lead promoted",
            description: "Human-created Relationship from a qualified leadgen company.",
            lifecycle_phase: "qualified",
            status: "done",
            priority: 2,
            is_key_task: true,
            native_kind: "leadgen_company",
            native_id: relationship.leadgen_company_id,
            native_href: workspaceHref(workspaceSlug, "leadgen"),
            planned_start_date: null,
            planned_end_date: null,
            actual_start_at: relationship.created_at,
            actual_completed_at: relationship.created_at,
            sort_order: 5,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
        })
    }

    if (relationship.client_id) {
        const [
            { data: progressRows },
            { data: activityRows },
            { data: saleRows },
        ] = await Promise.all([
            supabaseAdmin
                .from("client_progress")
                .select("id, step_key, completed_at, created_at")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true }),
            supabaseAdmin
                .from("client_activity")
                .select("id, activity_type, activity_text, created_at")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true })
                .limit(16),
            supabaseAdmin
                .from("client_sales")
                .select("id, status, total_amount, currency, created_at, updated_at, stripe_hosted_invoice_url")
                .eq("client_id", relationship.client_id)
                .order("created_at", { ascending: true }),
        ])

        synthesized.push({
            id: `client-${relationship.client_id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
            title: "Onboarding opened",
            description: "Client onboarding record exists in Betelgeze.",
            lifecycle_phase: "onboarding",
            status: relationship.status === "archived" ? "done" : "doing",
            priority: 2,
            is_key_task: true,
            native_kind: "client",
            native_id: relationship.client_id,
            native_href: clientNativeHref(workspaceSlug, relationship.client_id),
            planned_start_date: relationship.created_at.slice(0, 10),
            planned_end_date: null,
            actual_start_at: relationship.created_at,
            actual_completed_at: null,
            sort_order: 10,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
        })

        for (const sale of saleRows ?? []) {
            const paid = ["paid", "test_paid", "paid_awaiting_whatsapp_confirm", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent"].includes(String(sale.status))
            synthesized.push({
                id: `sale-${sale.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: paid ? "Invoice paid" : "Invoice in progress",
                description: `Invoice state: ${sale.status}`,
                lifecycle_phase: "invoiced",
                status: paid ? "done" : "doing",
                priority: paid ? 3 : 1,
                is_key_task: true,
                native_kind: "client_sale",
                native_id: sale.id,
                native_href: workspaceHref(workspaceSlug, "invoices"),
                planned_start_date: String(sale.created_at).slice(0, 10),
                planned_end_date: null,
                actual_start_at: sale.created_at,
                actual_completed_at: paid ? sale.updated_at ?? sale.created_at : null,
                sort_order: 8,
                metadata: {},
                created_at: sale.created_at,
                updated_at: sale.updated_at ?? sale.created_at,
                synthesized: true,
            })
        }

        for (const row of progressRows ?? []) {
            synthesized.push({
                id: `progress-${row.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: `Completed ${String(row.step_key).replace(/-/g, " ")}`,
                description: "Completed onboarding step.",
                lifecycle_phase: "onboarding",
                status: "done",
                priority: 4,
                is_key_task: false,
                native_kind: "client_progress",
                native_id: row.id,
                native_href: clientNativeHref(workspaceSlug, relationship.client_id),
                planned_start_date: null,
                planned_end_date: null,
                actual_start_at: row.created_at,
                actual_completed_at: row.completed_at ?? row.created_at,
                sort_order: 20,
                metadata: {},
                created_at: row.created_at,
                updated_at: row.completed_at ?? row.created_at,
                synthesized: true,
            })
        }

        for (const row of activityRows ?? []) {
            synthesized.push({
                id: `activity-${row.id}`,
                workspace_id: relationship.workspace_id,
                relationship_id: relationship.id,
                title: row.activity_text,
                description: `Activity type: ${row.activity_type}`,
                lifecycle_phase: "onboarding",
                status: "done",
                priority: 5,
                is_key_task: false,
                native_kind: "client_activity",
                native_id: row.id,
                native_href: clientNativeHref(workspaceSlug, relationship.client_id),
                planned_start_date: null,
                planned_end_date: null,
                actual_start_at: row.created_at,
                actual_completed_at: row.created_at,
                sort_order: 30,
                metadata: {},
                created_at: row.created_at,
                updated_at: row.created_at,
                synthesized: true,
            })
        }
    }

    if (storedItems.length + synthesized.length === 0) {
        synthesized.push({
            id: `next-${relationship.id}`,
            workspace_id: relationship.workspace_id,
            relationship_id: relationship.id,
            title: "Decide next action",
            description: "No work items have been attached yet.",
            lifecycle_phase: relationship.lifecycle_phase,
            status: "todo",
            priority: 2,
            is_key_task: true,
            native_kind: "relationship",
            native_id: relationship.id,
            native_href: relationshipHubHref(workspaceSlug, relationship.id),
            planned_start_date: now.slice(0, 10),
            planned_end_date: null,
            actual_start_at: null,
            actual_completed_at: null,
            sort_order: 1,
            metadata: {},
            created_at: now,
            updated_at: now,
            synthesized: true,
        })
    }

    const deduped = new Map<string, RelationshipWorkItem>()
    for (const item of [...storedItems, ...synthesized]) {
        const key = `${item.native_kind ?? "item"}:${item.native_id ?? item.id}:${item.title}`
        if (!deduped.has(key)) deduped.set(key, item)
    }
    return [...deduped.values()].sort(sortWorkItems)
}

export async function listWorkQueueItems(workspaceSlug: string, workspaceId: string): Promise<WorkQueueItem[]> {
    const result = await supabaseAdmin
        .from("relationship_work_items")
        .select("id, workspace_id, relationship_id, title, description, lifecycle_phase, status, priority, is_key_task, native_kind, native_id, native_href, planned_start_date, planned_end_date, actual_start_at, actual_completed_at, sort_order, metadata, created_at, updated_at, relationships!inner(id, primary_person_name, business_name, client_id)")
        .eq("workspace_id", workspaceId)
        .not("status", "in", "(done,canceled)")
        .order("priority", { ascending: true })
        .order("planned_end_date", { ascending: true, nullsFirst: false })
        .limit(80)

    if (!isMissingRelationshipSchema(result.error) && result.data?.length) {
        return result.data.map((row) => {
            const relationship = Array.isArray(row.relationships) ? row.relationships[0] : row.relationships
            return {
                ...row,
                lifecycle_phase: safePhase(row.lifecycle_phase),
                metadata: row.metadata ?? {},
                relationship,
            } as WorkQueueItem
        })
    }

    const relationships = await listRelationshipsForWorkspace(workspaceId)
    return relationships
        .filter((relationship) => relationship.status === "active" || relationship.status === "waiting" || relationship.status === "blocked")
        .slice(0, 50)
        .map((relationship) => ({
            id: `queue-${relationship.id}`,
            workspace_id: workspaceId,
            relationship_id: relationship.id,
            title: relationship.client_id ? "Continue onboarding" : "Decide next action",
            description: relationship.business_name ? `Relationship context: ${relationship.business_name}` : null,
            lifecycle_phase: relationship.lifecycle_phase,
            status: relationship.status === "blocked" ? "blocked" : "todo",
            priority: relationship.status === "blocked" ? 1 : 3,
            is_key_task: true,
            native_kind: relationship.client_id ? "client" : "relationship",
            native_id: relationship.client_id ?? relationship.id,
            native_href: relationship.client_id ? clientNativeHref(workspaceSlug, relationship.client_id) : relationshipHubHref(workspaceSlug, relationship.id),
            planned_start_date: relationship.created_at.slice(0, 10),
            planned_end_date: null,
            actual_start_at: null,
            actual_completed_at: null,
            sort_order: 0,
            metadata: {},
            created_at: relationship.created_at,
            updated_at: relationship.updated_at,
            synthesized: true,
            relationship: {
                id: relationship.id,
                primary_person_name: relationship.primary_person_name,
                business_name: relationship.business_name,
                client_id: relationship.client_id,
            },
        }))
}

export function nativeItemHref(workspaceSlug: string, item: RelationshipWorkItem) {
    if (item.native_kind === "client" && item.native_id) return clientNativeHref(workspaceSlug, item.native_id)
    if (item.native_href?.startsWith("/admin/client/") && item.native_id) return clientNativeHref(workspaceSlug, item.native_id)
    if (item.native_href?.startsWith("/")) return item.native_href
    return relationshipHubHref(workspaceSlug, item.relationship_id)
}

export function relationshipSearchHaystack(relationship: RelationshipRecord) {
    return [
        relationship.primary_person_name,
        relationship.primary_email,
        relationship.primary_phone,
        relationship.business_name,
        relationship.website_url,
        relationship.lifecycle_phase,
    ].filter(Boolean).join(" ").toLowerCase()
}

export function relationshipNativeLocation(workspaceSlug: string, relationship: RelationshipRecord) {
    return relationshipNativeHref(workspaceSlug, relationship)
}
