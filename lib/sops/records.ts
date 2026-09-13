import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SOP_PAGE_SIZE, sopCursor } from "./policy"
import { SOP_INTERPRETATION_VERSION } from "./interpretation"
import { isSopId, SOP_ASSET_PAGE_SIZE, validateSopRecord, type SopRecord, type SopAsset, type SopInterpretationSummary } from "./records-policy"
const fields = "id,title,description,version,archived_at,created_at,updated_at"
export async function listSopRecords(workspaceId: string, cursorValue?: string, archived = false) {
    const cursor = sopCursor(cursorValue)
    let query = supabaseAdmin.from("sops").select("id,title,version,archived_at,created_at,updated_at").eq("workspace_id", workspaceId)
    query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null)
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(SOP_PAGE_SIZE + 1)
    if (error) throw new Error("Could not load SOPs. Please try again.")
    const items = (data ?? []).slice(0, SOP_PAGE_SIZE) as Omit<SopRecord, "description">[]
    const last = items.at(-1)
    return { items, next: data && data.length > SOP_PAGE_SIZE && last ? `${last.created_at}|${last.id}` : null }
}
export async function getSopRecord(workspaceId: string, id: string) {
    if (!isSopId(id)) return null
    const { data, error } = await supabaseAdmin.from("sops").select(fields).eq("workspace_id", workspaceId).eq("id", id).maybeSingle()
    if (error) throw new Error("Could not load this SOP.")
    return data as SopRecord | null
}
export async function createSopRecord(workspaceId: string, userId: string, value: unknown) {
    const input = value as { id?: unknown }, details = validateSopRecord(value)
    if (!isSopId(input.id)) throw new Error("Invalid SOP request.")
    const { data, error } = await supabaseAdmin.rpc("create_sop_record", { p_workspace: workspaceId, p_actor: userId, p_id: input.id, p_title: details.title, p_description: details.description })
    if (error) throw new Error("Could not create the SOP. Retry with the same draft.")
    return data as string
}
export async function updateSopRecord(workspaceId: string, userId: string, id: string, value: unknown) {
    const input = value as { version?: number; archived?: boolean }, details = validateSopRecord(value)
    if (!isSopId(id) || !Number.isSafeInteger(input.version) || input.version! < 1 || typeof input.archived !== "boolean") throw new Error("Invalid SOP update.")
    const { data, error } = await supabaseAdmin.rpc("update_sop_record", { p_workspace: workspaceId, p_actor: userId, p_id: id, p_version: input.version, p_title: details.title, p_description: details.description, p_archived: input.archived })
    if (error) throw new Error("The SOP could not be saved or changed elsewhere. Refresh before retrying.")
    return data as number
}
export async function listSopAssets(workspaceId: string, sopId: string, cursorValue?: string) {
    const cursor = sopCursor(cursorValue)
    let query = supabaseAdmin.from("sop_assets").select("asset_id,sop_id,role,notes,created_at,asset:assets!inner(id,title,content_type,file_size),interpretations:sop_interpretations(id,asset_id,status,error_summary,created_at,updated_at)").eq("workspace_id", workspaceId).eq("sop_id", sopId).eq("interpretations.schema_version", SOP_INTERPRETATION_VERSION)
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},asset_id.lt.${cursor.id})`)
    const { data, error } = await query.order("created_at", { ascending: false }).order("asset_id", { ascending: false }).limit(SOP_ASSET_PAGE_SIZE + 1)
    if (error) throw new Error("Could not load the SOP assets.")
    // A bounded left embed returns status with each asset in the same read.
    // Full extracted content and provider metadata are loaded only on request.
    const rows = (data ?? []).slice(0, SOP_ASSET_PAGE_SIZE) as unknown as (SopAsset & { interpretations: SopInterpretationSummary[] })[]
    const items = rows.map(row => ({ asset_id: row.asset_id, sop_id: row.sop_id, role: row.role, notes: row.notes, created_at: row.created_at, asset: row.asset }))
    const interpretations = rows.flatMap(row => row.interpretations ?? [])
    const last = items.at(-1)
    return { items, interpretations, next: data && data.length > SOP_ASSET_PAGE_SIZE && last ? `${last.created_at}|${last.asset_id}` : null }
}
export async function getSopAsset(workspaceId: string, sopId: string, assetId: string) {
    if (![sopId, assetId].every(isSopId)) return null
    const { data, error } = await supabaseAdmin.from("sop_assets").select("asset_id,sop_id,role,notes,created_at,asset:assets!inner(id,title,content_type,file_size,storage_path)").eq("workspace_id", workspaceId).eq("sop_id", sopId).eq("asset_id", assetId).maybeSingle()
    if (error) throw new Error("Could not load the SOP asset.")
    return data as unknown as (SopAsset & { asset: SopAsset["asset"] & { storage_path: string } }) | null
}
