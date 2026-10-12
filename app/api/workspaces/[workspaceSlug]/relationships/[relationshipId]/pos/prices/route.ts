import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { SalePricingOverride } from "@/lib/client-sales/price-correction-types"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
export async function GET(request: Request, context: { params: Promise<{workspaceSlug: string; relationshipId: string}> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (request.headers.get("x-workspace-user") !== user.id || !["owner","admin"].includes(access.role)) return Response.json({error:"Owner or admin access required."},{status:403,headers})
    const recoveryId = new URL(request.url).searchParams.get("recovery")
    if (recoveryId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(recoveryId)) return Response.json({error:"Invalid recovery request."},{status:400,headers})
    const saleId = new URL(request.url).searchParams.get("sale") ?? ""
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saleId)) return Response.json({error:"Invalid sale."},{status:400,headers})
    const [saleResult, lineResult] = await Promise.all([
        supabaseAdmin.from("client_sales").select("id,status,currency,billing_interval,billing_interval_count,pricing_revision,pricing_override,pricing_correction_id,initial_payment_received_at,stripe_subscription_id").eq("workspace_id",workspace.id).eq("relationship_id",relationshipId).eq("id",saleId).eq("service_scope","selected_services").is("deleted_at",null).maybeSingle(),
        supabaseAdmin.from("client_sale_items").select("id,service_name,service_revision_id,upfront_amount_cents,recurring_amount_cents").eq("workspace_id",workspace.id).eq("client_sale_id",saleId).order("sort_order").limit(31),
    ])
    if (saleResult.error || lineResult.error) return Response.json({error:"Could not load the saved prices."},{status:503,headers})
    const sale = saleResult.data, items = lineResult.data
    if (!sale || !items.length || items.length > 30) return Response.json({error:"Sale not available for correction."},{status:404,headers})
    if (!recoveryId && !sale.pricing_correction_id && (!["sale_confirmation_pending","onboarding_payment_pending","onboarding_link_sent","onboarding_link_failed","payment_failed"].includes(sale.status) || sale.initial_payment_received_at || sale.stripe_subscription_id)) return Response.json({error:"This sale is no longer unpaid. Reload its payment status."},{status:409,headers})
    const [revisions, pending] = await Promise.all([
        supabaseAdmin.from("onboarding_service_revisions").select("id,definition,default_recurring_price_cents").eq("workspace_id",workspace.id).in("id",items.map(item => item.service_revision_id)),
        (recoveryId || sale.pricing_correction_id) ? supabaseAdmin.from("client_sale_price_corrections").select("request_id,sale_id,expected_version,terms,reason,previous_checkout_id,state").eq("workspace_id",workspace.id).eq("sale_id",saleId).eq("request_id",recoveryId || sale.pricing_correction_id).maybeSingle() : Promise.resolve({data:null,error:null}),
    ])
    if (revisions.error || pending.error) return Response.json({error:"Could not verify the saved pricing configuration."},{status:503,headers})
    const override = sale.pricing_override as SalePricingOverride | null
    const lines = items.map(item => ({id:item.id,upfrontCents:override?.linePrices[item.id]?.upfrontCents ?? item.upfront_amount_cents,recurringCents:override?.linePrices[item.id]?.recurringCents ?? item.recurring_amount_cents}))
    return Response.json({saleId,version:sale.pricing_revision,currency:sale.currency,pending:pending.data,
        terms:{lines,upfrontTotal:lines.reduce((sum,line)=>sum+line.upfrontCents,0),recurringTotal:lines.reduce((sum,line)=>sum+line.recurringCents,0),billingInterval:override?.billingInterval ?? sale.billing_interval ?? "month",billingIntervalCount:override?.billingIntervalCount ?? sale.billing_interval_count ?? 1},
        lines:items.map(item=>{const revision=revisions.data.find(row=>row.id===item.service_revision_id);return{id:item.id,name:item.service_name,recurringAllowed:revision?.default_recurring_price_cents>0 || [revision?.definition?.serviceType,revision?.definition?.service_type].includes("retainer")}}),
    },{headers})
}
