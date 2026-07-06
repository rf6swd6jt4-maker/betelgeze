import type { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    clientNativeHref,
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
    path?: string
    recordId?: string
}

function includesQuery(values: Array<unknown>, query: string) {
    return values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ")
        .toLowerCase()
        .includes(query)
}

function result(id: string, type: string, label: string, description: string, href: string, options: Pick<SearchResult, "hubHref" | "path" | "recordId"> = {}): SearchResult {
    return { id, type, label, description, href, ...options }
}

function staticNavigationResults(workspace: { name: string; slug: string }, query: string): SearchResult[] {
    const settingsPath = `${workspace.name} > Settings`
    const entries = [
        { id: "page-home", type: "Page", label: "Home", description: "Workspace home and onboarding overview", href: workspaceHref(workspace.slug), path: workspace.name, keywords: ["dashboard", "clients", "onboarding"] },
        { id: "page-relationships", type: "Page", label: "Relationships", description: "Relationship Hub list", href: workspaceHref(workspace.slug, "relationships"), path: `${workspace.name} > Relationships`, keywords: ["crm", "clients", "people"] },
        { id: "page-work", type: "Page", label: "Work Queue", description: "Shared relationship work items", href: workspaceHref(workspace.slug, "work"), path: `${workspace.name} > Work Queue`, keywords: ["tasks", "project management", "queue"] },
        { id: "page-leadgen", type: "Page", label: "Lead Gen", description: "Lead generation dashboard", href: workspaceHref(workspace.slug, "leadgen"), path: `${workspace.name} > Lead Gen`, keywords: ["leads", "lead generation"] },
        { id: "page-leads", type: "Tab", label: "Leads", description: "Qualified and discovered lead list", href: workspaceHref(workspace.slug, "leadgen"), path: `${workspace.name} > Lead Gen > Leads`, keywords: ["leadgen companies", "lead list"] },
        { id: "page-polls", type: "Tab", label: "Polls", description: "Lead generation poll history", href: workspaceHref(workspace.slug, "leadgen/polls"), path: `${workspace.name} > Lead Gen > Polls`, keywords: ["runs", "automation history"] },
        { id: "page-invoices", type: "Page", label: "Invoices", description: "Client invoices and sales", href: workspaceHref(workspace.slug, "invoices"), path: `${workspace.name} > Invoices`, keywords: ["sales", "stripe"] },
        { id: "page-health", type: "Page", label: "System Health", description: "Operational checks for invoices, WhatsApp, ClickUp, storage, and infrastructure", href: workspaceHref(workspace.slug, "health"), path: `${workspace.name} > System Health`, keywords: ["health", "status", "checks", "diagnostics", "integrations"] },
        { id: "page-settings", type: "Page", label: "Settings", description: "Unified workspace settings", href: workspaceHref(workspace.slug, "settings"), path: settingsPath, keywords: ["workspace settings"] },
        { id: "settings-workspace", type: "Settings", label: "Workspace", description: "Edit the workspace name", href: workspaceHref(workspace.slug, "settings#workspace"), path: `${settingsPath} > Workspace`, keywords: ["name", "identity"] },
        { id: "settings-onboarding-domain", type: "Settings", label: "Onboarding Domain", description: "Client portal hostname", href: workspaceHref(workspace.slug, "settings#onboarding-domain"), path: `${settingsPath} > Onboarding Domain`, keywords: ["custom domain", "hostname", "portal"] },
        { id: "settings-connections", type: "Settings", label: "Connections", description: "Stripe, WhatsApp, and ClickUp credentials", href: workspaceHref(workspace.slug, "settings#connections"), path: `${settingsPath} > Connections`, keywords: ["stripe", "whatsapp", "meta", "clickup"] },
        { id: "settings-users", type: "Settings", label: "Users", description: "Access and invitations", href: workspaceHref(workspace.slug, "settings#users"), path: `${settingsPath} > Users`, keywords: ["team", "members", "invite"] },
        { id: "settings-leadgen-automation", type: "Settings", label: "Lead Gen Automation", description: "Poll cadence, candidate volume, and owner-evidence defaults", href: workspaceHref(workspace.slug, "settings#leadgen-automation"), path: `${settingsPath} > Lead Gen Automation`, keywords: ["poll automation", "automatic polls", "cadence"] },
        { id: "settings-leadgen-targeting", type: "Settings", label: "Lead Gen Targeting", description: "ICP industries and locations", href: workspaceHref(workspace.slug, "settings#leadgen-targeting"), path: `${settingsPath} > Lead Gen Targeting`, keywords: ["industries", "locations", "icp"] },
        { id: "settings-leadgen-sources", type: "Settings", label: "Lead Gen Sources", description: "Source readiness, mappings, and controls", href: workspaceHref(workspace.slug, "settings#leadgen-sources"), path: `${settingsPath} > Lead Gen Sources`, keywords: ["sources", "mappings", "source controls"] },
    ]

    return entries
        .filter((entry) => includesQuery([entry.label, entry.description, entry.path, ...entry.keywords], query))
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            label: entry.label,
            description: entry.description,
            href: entry.href,
            path: entry.path,
        }))
        .slice(0, 6)
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
    results.push(...staticNavigationResults(workspace, query))

    const relationships = await listRelationshipsForWorkspace(workspace.id)

    for (const relationship of relationships.filter((item) => relationshipSearchHaystack(item).includes(query) || includesQuery([item.id, item.client_id, item.leadgen_company_id], query)).slice(0, 8)) {
        results.push(result(
            `relationship-${relationship.id}`,
            "Relationship",
            relationship.primary_person_name,
            relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "Relationship Hub",
            relationshipNativeLocation(workspace.slug, relationship),
            {
                hubHref: relationshipHubHref(workspace.slug, relationship.id),
                path: `${workspace.name} > Relationships`,
                recordId: relationship.client_id ?? relationship.id,
            }
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
        for (const item of (workItems.data ?? []).filter((item) => includesQuery([item.id, item.native_id, item.title, item.description, item.lifecycle_phase], query)).slice(0, 6)) {
            const relationship = relationshipById.get(item.relationship_id)
            results.push(result(
                `work-${item.id}`,
                "Work item",
                item.title,
                relationship?.primary_person_name ?? item.description ?? "Relationship work",
                item.native_href?.startsWith("/") ? item.native_href : relationship ? relationshipHubHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, "work"),
                {
                    hubHref: relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined,
                    path: `${workspace.name} > Work Queue`,
                    recordId: item.native_id ?? item.id,
                }
            ))
        }
    }

    const [
        { data: clients, error: clientError },
        { data: companies, error: companyError },
        { data: polls, error: pollError },
        { data: sales, error: salesError },
        { data: channels, error: channelError },
        { data: activities, error: activityError },
    ] = await Promise.all([
        supabaseAdmin
            .from("clients")
            .select("id, name, email, phone, created_at, archived_at")
            .eq("workspace_id", workspace.id)
            .is("archived_at", null)
            .order("created_at", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("leadgen_companies")
            .select("id, display_name, legal_name, dba_name, entity_number, owner_name, owner_phone, phone, website_url, source_key, source_record_id, first_seen_poll_id, qualification_status")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("leadgen_polls")
            .select("id, status, trigger, source_count, candidate_count, qualified_count, error, created_at")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("client_sales")
            .select("id, client_id, client_name, client_email, client_phone, status, stripe_invoice_id")
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

    if (!clientError) {
        for (const client of (clients ?? []).filter((client) => includesQuery([client.id, client.name, client.email, client.phone], query)).slice(0, 6)) {
            const relationship = relationshipByClientId.get(client.id)
            results.push(result(
                `client-${client.id}`,
                "Client",
                client.name ?? client.email ?? "Unnamed client",
                client.email ?? client.phone ?? "Onboarding client",
                clientNativeHref(workspace.slug, client.id),
                {
                    hubHref: relationship ? relationshipHubHref(workspace.slug, relationship.id) : relationshipHubHref(workspace.slug, client.id),
                    path: `${workspace.name} > Onboarding > Clients`,
                    recordId: client.id,
                }
            ))
        }
    }

    if (!companyError) {
        for (const company of (companies ?? []).filter((company) => includesQuery([company.id, company.display_name, company.legal_name, company.dba_name, company.entity_number, company.owner_name, company.owner_phone, company.phone, company.website_url, company.source_key, company.source_record_id, company.first_seen_poll_id], query)).slice(0, 5)) {
            results.push(result(
                `leadgen-${company.id}`,
                "Lead",
                company.owner_name ? `${company.owner_name} - ${company.display_name}` : company.display_name,
                [company.qualification_status, company.phone ?? company.owner_phone].filter(Boolean).join(" · ") || "Lead generation result",
                workspaceHref(workspace.slug, "leadgen"),
                {
                    path: `${workspace.name} > Lead Gen > Leads`,
                    recordId: company.id,
                }
            ))
        }
    }

    if (!pollError) {
        for (const poll of (polls ?? []).filter((poll) => includesQuery([poll.id, poll.status, poll.trigger, poll.error], query)).slice(0, 5)) {
            results.push(result(
                `poll-${poll.id}`,
                "Poll",
                `Lead poll ${String(poll.id).slice(0, 8)}`,
                `${poll.status} · ${poll.trigger} · ${poll.qualified_count ?? 0} qualified`,
                workspaceHref(workspace.slug, `leadgen/poll/${poll.id}`),
                {
                    path: `${workspace.name} > Lead Gen > Polls`,
                    recordId: poll.id,
                }
            ))
        }
    }

    if (!salesError) {
        for (const sale of (sales ?? []).filter((sale) => includesQuery([sale.id, sale.stripe_invoice_id, sale.client_id, sale.client_name, sale.client_email, sale.client_phone, sale.status], query)).slice(0, 5)) {
            const relationship = sale.client_id ? relationshipByClientId.get(sale.client_id) : null
            results.push(result(
                `sale-${sale.id}`,
                "Invoice/sale",
                sale.client_name,
                [sale.stripe_invoice_id ?? sale.id, sale.status].filter(Boolean).join(" · "),
                workspaceHref(workspace.slug, "invoices"),
                {
                    hubHref: relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined,
                    path: `${workspace.name} > Invoices`,
                    recordId: sale.stripe_invoice_id ?? sale.id,
                }
            ))
        }
    }

    if (!channelError) {
        for (const channel of (channels ?? []).filter((channel) => includesQuery([channel.id, channel.client_id, channel.external_address, channel.provider], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(channel.client_id)
            results.push(result(
                `contact-${channel.id}`,
                "Contact",
                channel.external_address,
                channel.provider,
                relationship ? relationshipNativeLocation(workspace.slug, relationship) : workspaceHref(workspace.slug, "relationships"),
                {
                    hubHref: relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined,
                    path: `${workspace.name} > Contacts`,
                    recordId: channel.id,
                }
            ))
        }
    }

    if (!activityError) {
        for (const activity of (activities ?? []).filter((activity) => includesQuery([activity.id, activity.client_id, activity.activity_text, activity.activity_type], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(activity.client_id)
            results.push(result(
                `activity-${activity.id}`,
                "Activity",
                activity.activity_text,
                activity.activity_type,
                relationship ? relationshipNativeLocation(workspace.slug, relationship) : workspaceHref(workspace.slug, "relationships"),
                {
                    hubHref: relationship ? relationshipHubHref(workspace.slug, relationship.id) : undefined,
                    path: `${workspace.name} > Recent Activity`,
                    recordId: activity.id,
                }
            ))
        }
    }

    return Response.json({ results: results.slice(0, 20) })
}
