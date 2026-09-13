export const sopPrivateHeaders = { "Cache-Control": "private, no-store" }
export function sopMutationOrigin(request: Request) { return !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin }
export async function sopPayload(request: Request) {
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Invalid request.")
    const chunks: Uint8Array[] = []; let size = 0
    try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 20000) throw new Error("Request is too large."); chunks.push(value) }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export function sopError(error: unknown, fallback: string) { return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 400, headers: sopPrivateHeaders }) }
