/** Persist only accepted-to-send scalar intent, never File bytes or credentials. */
export function serializeRecordCreate(form: FormData) {
    const values = [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string")
    return JSON.stringify({ version: 1, values })
}
export function parseRecordCreate(raw: string | null, userId: string): FormData | null {
    if (!raw) return null
    if (raw.length > 60000) throw new Error("Saved create request is too large. Keep this window open and contact support.")
    const data = JSON.parse(raw) as { version: number; values: unknown }
    if (data.version !== 1 || !Array.isArray(data.values) || data.values.length > 70 || data.values.some(row => !Array.isArray(row) || row.length !== 2 || row.some(value => typeof value !== "string"))) throw new Error("Saved create request is invalid. It has not been discarded.")
    const form = new FormData()
    for (const [key, value] of data.values as [string, string][]) form.append(key, value)
    if (form.get("expected_user_id") !== userId) throw new Error("Saved create request belongs to another account.")
    return form
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">
export type SavedRecordCreate = { key: string; raw: string; form: FormData }
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Each independent intent owns an immutable key, so tabs cannot erase each other's drafts. */
export function saveRecordCreate(storage: DraftStorage, prefix: string, form: FormData): SavedRecordCreate {
    const id = String(form.get("record_request_id") ?? "")
    if (!REQUEST_ID.test(id)) throw new Error("Saved request identity is invalid.")
    const key = `${prefix}:${id}`, raw = serializeRecordCreate(form), prior = storage.getItem(key)
    if (prior && prior !== raw) throw new Error("This saved request already has different values. Its original draft has been preserved.")
    storage.setItem(key, raw)
    return { key, raw, form }
}

export function recoverRecordCreates(storage: DraftStorage, prefix: string, userId: string): SavedRecordCreate[] {
    const keys = new Set<string>()
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key === prefix || key?.startsWith(`${prefix}:`)) keys.add(key)
    }
    const recovered: SavedRecordCreate[] = []
    for (const key of [...keys].sort()) {
        const raw = storage.getItem(key), form = parseRecordCreate(raw, userId)
        if (!form || !raw) continue
        const id = String(form.get("record_request_id") ?? "")
        if (!REQUEST_ID.test(id) || (key !== prefix && key !== `${prefix}:${id}`)) throw new Error("Saved request identity is invalid. It has not been discarded.")
        recovered.push({ key, raw, form })
    }
    return recovered
}

export function acknowledgeRecordCreate(storage: DraftStorage, saved: SavedRecordCreate) {
    if (storage.getItem(saved.key) === saved.raw) storage.removeItem(saved.key)
}

/** Only a persisted terminal rejection, never an error code, releases immutable intent. */
export function confirmedRecordRejection(result: { error?: unknown; data?: unknown }) {
    const data = result.data as { status?: unknown; error?: unknown } | null
    return !result.error && data?.status === "rejected" && typeof data.error === "string"
}
