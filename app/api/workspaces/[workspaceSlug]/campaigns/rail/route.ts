import { campaignsPilotEnabled } from "@/lib/campaigns/pilot"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/**
 * The sidebar's Campaigns section: the workspace's campaigns by name and how many of each one's leads are not booked
 * yet. Pilot owners and admins only. Two bounded reads; it is fetched after the shell has painted, never before.
 */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    if (!campaignsPilotEnabled(user.id) || (role !== "owner" && role !== "admin")) return Response.json({ allowed: false, campaigns: [] }, { headers })

    const { data, error } = await supabaseAdmin.from("campaigns").select("id, name, status").eq("workspace_id", workspace.id).neq("status", "archived").order("created_at").limit(50)
    if (error) return Response.json({ error: "Could not load campaigns." }, { status: 503, headers })
    const campaigns = (data ?? []) as Array<{ id: string; name: string; status: string }>
    const counts = new Map<string, number>()
    if (campaigns.length) {
        const { data: open, error: openError } = await supabaseAdmin.from("campaign_leads").select("latest_campaign_id")
            .eq("workspace_id", workspace.id).in("latest_campaign_id", campaigns.map(campaign => campaign.id)).in("stage", ["not_booked", "paid_not_booked"]).limit(2000)
        if (openError) return Response.json({ error: "Could not load campaigns." }, { status: 503, headers })
        for (const row of (open ?? []) as Array<{ latest_campaign_id: string }>) counts.set(row.latest_campaign_id, (counts.get(row.latest_campaign_id) ?? 0) + 1)
    }
    return Response.json({ allowed: true, campaigns: campaigns.map(campaign => ({ id: campaign.id, name: campaign.name, status: campaign.status, notBooked: counts.get(campaign.id) ?? 0 })) }, { headers })
}
