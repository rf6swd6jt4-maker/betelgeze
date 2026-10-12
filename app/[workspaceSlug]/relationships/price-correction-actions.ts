"use server"
import { revalidatePath } from "next/cache"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { validPriceCorrection, type PriceCorrectionRequest } from "@/lib/client-sales/price-correction-types"
import { correctUnpaidSalePrices } from "@/lib/client-sales/price-correction"
export async function correctUnpaidServiceSale(slug: string, relationshipId: string, expectedUserId: string, request: PriceCorrectionRequest) {
    const { workspace, user, access } = await requireWorkspacePanel(slug,"relationships")
    await requireRelationshipAccess(access,relationshipId)
    if (user.id !== expectedUserId || !["owner","admin"].includes(access.role) || !validPriceCorrection(request)) return {ok:false,uncertain:false,error:"Check your account, the service prices and the correction reason."}
    const result = await correctUnpaidSalePrices(workspace.id,relationshipId,user.id,request)
    if (result.ok) {
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
        revalidatePath(`/${slug}/onboarding`)
    }
    return result
}
