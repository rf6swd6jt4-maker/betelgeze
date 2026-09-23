export const LEADGEN_HISTORY_PAGE_SIZE = 40

// Only these literal-safe values enter the PostgREST keyset expression. Keep
// PostgreSQL timestamp precision instead of converting through browser dates.
export function leadgenHistoryCursor(before?: string, beforeId?: string) {
    if (!before || !beforeId
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(before)
        || !Number.isFinite(Date.parse(before))
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId)) return null
    return { before, beforeId }
}
