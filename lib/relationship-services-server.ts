import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { RelationshipRecord } from "@/lib/relationships"
import type { RelationshipDraft } from "@/lib/relationship-draft-command"
import type { RelationshipServicePage, RelationshipServiceSummary } from "@/lib/service-stages"

export const readRelationshipServices = cache(async (workspaceId: string, relationshipId: string, userId: string, offset = 0): Promise<RelationshipServicePage> => {
    const { data, error } = await supabaseAdmin.rpc("read_relationship_services", { p_workspace_id: workspaceId, p_relationship_id: relationshipId, p_user_id: userId, p_offset: offset })
    if (error) throw new Error("Could not load relationship services")
    return { items: (data as RelationshipServicePage).items.slice(0, 30), hasMore: data.hasMore, values: data.values }
})

export async function summarizeRelationshipServices(workspaceId: string, userId: string, ids: string[]): Promise<RelationshipServiceSummary[]> {
    if (!ids.length) return []
    // The parent list is existing shell data. Each summary contains at most four names.
    const results: RelationshipServiceSummary[] = []
    for (let offset = 0; offset < ids.length; offset += 1000) {
        const { data, error } = await supabaseAdmin.rpc("summarize_relationship_services", { p_workspace_id: workspaceId, p_user_id: userId, p_relationship_ids: ids.slice(offset, offset + 1000) })
        if (error) throw new Error("Could not load service summaries")
        results.push(...data)
    }
    return results
}

export function relationshipBackgroundDraft(r: RelationshipRecord): RelationshipDraft {
    return {
        primaryPersonName: r.primary_person_name, businessName: r.business_name ?? "", primaryContactRole: r.primary_contact_role ?? "",
        primaryPhone: r.primary_phone ?? "", whatsappPhone: r.whatsapp_phone ?? "", primaryEmail: r.primary_email ?? "",
        communicationPrimaryProvider: r.communication_primary_provider, communicationDeliveryMode: r.communication_delivery_mode, description: r.notes_summary ?? "",
        sellerUserId: r.seller_user_id ?? "", fulfilmentManagerUserId: r.fulfilment_manager_user_id ?? "", fulfilmentTeamId: r.fulfilment_team_id ?? "", projectTimeframeDays: r.project_timeframe_days,
        selectedCodes: [], serviceAssignees: {}, upfrontPrices: {}, recurringPrices: {}, currency: "USD", billingInterval: "month", billingIntervalCount: 1,
    }
}
