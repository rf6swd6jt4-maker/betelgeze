import "server-only"

/**
 * A thin SignalHouse API client (https://app2.signalhouse.io/docs). Bearer API key, JSON in and out (or form data, for
 * MMS: `POST /message/mms` with the picture uploaded as `images`), a 15-second limit (30 for form data), and an
 * Idempotency-Key on writes so a retried request replays the first answer instead of acting twice.
 */
export const SIGNALHOUSE_API_BASE_URL = (process.env.SIGNALHOUSE_API_BASE_URL?.trim() || "https://v2.signalhouse.io").replace(/\/$/, "")

export class SignalHouseError extends Error {
    constructor(message: string, readonly status: number) { super(message) }
}

export async function signalHouseRequest<T = unknown>(apiKey: string, path: string, init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    let response: Response
    const form = typeof FormData !== "undefined" && init.body instanceof FormData
    try {
        response = await fetch(`${SIGNALHOUSE_API_BASE_URL}${path}`, {
            method: init.method ?? "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                // Form data sets its own multipart boundary.
                ...(form ? {} : { "Content-Type": "application/json" }),
                ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
            },
            body: init.body === undefined ? undefined : form ? init.body as FormData : JSON.stringify(init.body),
            cache: "no-store",
            signal: AbortSignal.timeout(form ? 30_000 : 15_000),
        })
    } catch {
        throw new SignalHouseError("SignalHouse did not answer. Please retry.", 0)
    }
    const text = await response.text()
    let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!response.ok) {
        const message = json && typeof json === "object" ? String((json as Record<string, unknown>).message ?? (json as Record<string, unknown>).error ?? "") : ""
        const friendly = response.status === 401 || response.status === 403
            ? "SignalHouse refused the API key. Check that it is an active key for this group."
            : message ? `SignalHouse: ${message.slice(0, 200)}` : `SignalHouse answered ${response.status}.`
        throw new SignalHouseError(friendly, response.status)
    }
    return json as T
}

/** List responses come as a bare array or wrapped ({ data }, { items }, { data: { items } }). */
export function signalHouseList(value: unknown): Record<string, unknown>[] {
    const pick = (item: unknown): unknown[] | null => Array.isArray(item) ? item : null
    const record = value && typeof value === "object" ? value as Record<string, unknown> : null
    const data = record?.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null
    const list = pick(value) ?? pick(record?.data) ?? pick(record?.items) ?? pick(data?.items) ?? pick(data?.results) ?? pick(record?.results) ?? []
    return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
}

/** A single-object response, bare or wrapped in { data }. */
export function signalHouseObject(value: unknown): Record<string, unknown> {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
    return record.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data as Record<string, unknown> : record
}
