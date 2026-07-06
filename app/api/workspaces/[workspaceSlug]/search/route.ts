import type { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    listRelationshipsForWorkspace,
    relationshipHubHref,
    relationshipNativeLocation,
    relationshipSearchHaystack,
    workspaceHref,
    type RelationshipRecord,
} from "@/lib/relationships"

export const dynamic = "force-dynamic"

type SearchResult = {
    id: string
    type: string
    label: string
    description: string
    href: string
    hubHref?: string
}

function includesQuery(values: Array<unknown>, query: string) {
    return values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ")
        .toLowerCase()
        .includes(query)
}

function result(id: string, type: string, label: string, description: string, href: string, hubHref?: string): SearchResult {
    return { id, type, label, description, href, hubHref }
}

async function requireSearchWorkspace(workspaceSlug: string) {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return null

    const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", workspaceSlug)
        .eq("status", "active")
        .maybeSingle()

    if (!workspace) return null

    const { data: membership } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .maybeSingle()

    return membership ? workspace as { id: string; slug: string; name: string; status: string } : null
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const workspace = await requireSearchWorkspace(workspaceSlug)
    if (!workspace) return Response.json({ results: [] }, { status: 401 })

    const rawQuery = request.nextUrl.searchParams.get("q") ?? ""
    const query = rawQuery.trim().toLowerCase()
    if (query.length < 2) return Response.json({ results: [] })

    const results: SearchResult[] = []
    const relationships = await listRelationshipsForWorkspace(workspace.id)

    for (const relationship of relationships.filter((item) => relationshipSearchHaystack(item).includes(query)).slice(0, 8)) {
        results.push(result(
            `relationship-${relationship.id}`,
            "Relationship",
            relationship.primary_person_name,
            relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "Relationship Hub",
            relationshipNativeLocation(workspace.slug, relationship),
            relationshipHubHref(workspace.slug, relationship.id)
        ))
    }

    const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]))
    const relationshipByClientId = new Map(relationships.map((relationship) => [relationship.client_id, relationship]).filter((entry): entry is [string, RelationshipRecord] => Boolean(entry[0])))

    const workItems = await supabaseAdmin
        .from("relationship_work_items")
        .select("id, relationship_id, title, description, lifecycle_phase, native_href, native_kind, native_id")
        .eq("workspace_id", workspace.id)
        .limit(80)

    if (!workItems.error) {
        for (const item of (workItems.data ?? []).filter((item) => includesQuery([item.title, item.description, item.lifecycle_phase], query)).slice(0, 6)) {
            const relationship = relationshipById.get(item.relationship_id)
            results.push(result(
                `work-${item.id}`,
                "Work item",
                item.title,
                relationship?.primary_person_name ?? item.description ?? "Relationship work",
                item.native_href?.startsWith("/") ? item.native_href : relationship ? relationshipHubHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, "work"),
                relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined
            ))
        }
    }

    const [
        { data: companies, error: companyError },
        { data: sales, error: salesError },
        { data: channels, error: channelError },
        { data: activities, error: activityError },
    ] = await Promise.all([
        supabaseAdmin
            .from("leadgen_companies")
            .select("id, display_name, owner_name, owner_phone, phone, website_url, qualification_status")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("client_sales")
            .select("id, client_id, client_name, client_email, client_phone, status")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(60),
        supabaseAdmin
            .from("client_communication_channels")
            .select("id, client_id, external_address, provider")
            .eq("workspace_id", workspace.id)
            .limit(60),
        supabaseAdmin
            .from("client_activity")
            .select("id, client_id, activity_text, activity_type")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(60),
    ])

    if (!companyError) {
        for (const company of (companies ?? []).filter((company) => includesQuery([company.display_name, company.owner_name, company.owner_phone, company.phone, company.website_url], query)).slice(0, 5)) {
            results.push(result(
                `leadgen-${company.id}`,
                "Leadgen company",
                company.owner_name ? `${company.owner_name} - ${company.display_name}` : company.display_name,
                company.qualification_status ?? "Leadgen result",
                workspaceHref(workspace.slug, "leadgen")
            ))
        }
    }

    if (!salesError) {
        for (const sale of (sales ?? []).filter((sale) => includesQuery([sale.client_name, sale.client_email, sale.client_phone, sale.status], query)).slice(0, 5)) {
            const relationship = sale.client_id ? relationshipByClientId.get(sale.client_id) : null
            results.push(result(
                `sale-${sale.id}`,
                "Invoice/sale",
                sale.client_name,
                sale.status,
                workspaceHref(workspace.slug, "invoices"),
                relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined
            ))
        }
    }

    if (!channelError) {
        for (const channel of (channels ?? []).filter((channel) => includesQuery([channel.external_address, channel.provider], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(channel.client_id)
            results.push(result(
                `contact-${channel.id}`,
                "Contact",
                channel.external_address,
                channel.provider,
                relationship ? relationshipNativeLocation(workspace.slug, relationship) : workspaceHref(workspace.slug, "relationships"),
                relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined
            ))
        }
    }

    if (!activityError) {
        for (const activity of (activities ?? []).filter((activity) => includesQuery([activity.activity_text, activity.activity_type], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(activity.client_id)
            results.push(result(
                `activity-${activity.id}`,
                "Activity",
                activity.activity_text,
                activity.activity_type,
                relationship ? relationshipNativeLocation(workspace.slug, relationship) : workspaceHref(workspace.slug, "relationships"),
                relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined
            ))
        }
    }

    return Response.json({ results: results.slice(0, 20) })
}
