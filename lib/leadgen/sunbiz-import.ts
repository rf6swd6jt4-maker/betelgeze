import { parseSunbizOwnerIndexRows, type SunbizOwnerIndexRow } from "@/lib/leadgen/sunbiz-bulk-index"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type SunbizImportSourceKey = SunbizOwnerIndexRow["source_key"]
export type SunbizImportMode = "append" | "replace"

export type SunbizImportSummary = {
    sourceKey: SunbizImportSourceKey
    mode: SunbizImportMode
    parsedRows: number
    importedRows: number
    batches: number
    dryRun: boolean
}

const SUNBIZ_IMPORT_SOURCES = new Set<SunbizImportSourceKey>([
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
])

export function normaliseSunbizImportSourceKey(value: string | null | undefined): SunbizImportSourceKey | null {
    const sourceKey = String(value ?? "").trim()
    return SUNBIZ_IMPORT_SOURCES.has(sourceKey as SunbizImportSourceKey) ? sourceKey as SunbizImportSourceKey : null
}

export function normaliseSunbizImportMode(value: string | null | undefined): SunbizImportMode {
    return String(value ?? "").trim().toLowerCase() === "replace" ? "replace" : "append"
}

function dbRow(row: SunbizOwnerIndexRow) {
    return {
        source_key: row.source_key,
        record_id: row.record_id,
        business_name: row.business_name,
        status: row.status,
        record_type: row.record_type,
        person_name: row.person_name,
        person_role: row.person_role,
        person_source_field: row.person_source_field,
        person_type: row.person_type,
        address: row.address,
        search_text: row.search_text,
        raw_payload: row.raw_payload,
        imported_at: new Date().toISOString(),
    }
}

export async function clearSunbizOwnerIndex(sourceKey: SunbizImportSourceKey) {
    const { error } = await supabaseAdmin
        .from("leadgen_sunbiz_owner_index")
        .delete()
        .eq("source_key", sourceKey)
    if (error) throw new Error(`Could not clear existing Sunbiz index rows: ${error.message}`)
}

export async function upsertSunbizOwnerIndexRows(rows: SunbizOwnerIndexRow[]) {
    if (rows.length === 0) return 0
    const { error } = await supabaseAdmin
        .from("leadgen_sunbiz_owner_index")
        .upsert(rows.map(dbRow), {
            onConflict: "source_key,record_id,person_source_field,person_name",
        })
    if (error) throw new Error(`Could not import Sunbiz index rows: ${error.message}`)
    return rows.length
}

export async function markSunbizOwnerIndexImportHealthy({
    sourceKey,
    mode,
    parsedRows,
    importedRows,
    importer,
}: {
    sourceKey: SunbizImportSourceKey
    mode: SunbizImportMode
    parsedRows: number
    importedRows: number
    importer: string
}) {
    await supabaseAdmin
        .from("leadgen_source_health")
        .upsert({
            source_key: sourceKey,
            status: "healthy",
            last_error: null,
            last_success_at: new Date().toISOString(),
            metadata: {
                import_mode: mode,
                imported_rows: importedRows,
                parsed_rows: parsedRows,
                importer,
            },
        }, { onConflict: "source_key" })
}

export async function importSunbizOwnerIndexFromText({
    sourceKey,
    text,
    mode = "append",
    dryRun = false,
    batchSize = 500,
}: {
    sourceKey: SunbizImportSourceKey
    text: string
    mode?: SunbizImportMode
    dryRun?: boolean
    batchSize?: number
}): Promise<SunbizImportSummary> {
    const rows = parseSunbizOwnerIndexRows(sourceKey, text)
    const safeBatchSize = Math.min(1000, Math.max(50, Math.floor(batchSize)))
    if (rows.length === 0) throw new Error("The Sunbiz file did not contain any importable person owner/officer rows for this source.")
    if (dryRun) {
        return { sourceKey, mode, parsedRows: rows.length, importedRows: 0, batches: 0, dryRun: true }
    }

    if (mode === "replace") {
        await clearSunbizOwnerIndex(sourceKey)
    }

    let importedRows = 0
    let batches = 0
    for (let index = 0; index < rows.length; index += safeBatchSize) {
        const batch = rows.slice(index, index + safeBatchSize)
        importedRows += await upsertSunbizOwnerIndexRows(batch)
        batches += 1
    }

    await markSunbizOwnerIndexImportHealthy({
        sourceKey,
        mode,
        parsedRows: rows.length,
        importedRows,
        importer: "leadgen_sunbiz_import_v5_4_1",
    })

    return { sourceKey, mode, parsedRows: rows.length, importedRows, batches, dryRun: false }
}
