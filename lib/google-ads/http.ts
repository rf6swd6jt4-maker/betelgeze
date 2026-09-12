export const googleAdsHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
export const googleAdsReply = (body: unknown, status = 200) => Response.json(body, { status, headers: googleAdsHeaders })
export async function googleAdsBody(request: Request): Promise<Record<string, unknown>> {
    const origin = request.headers.get("origin")
    if (request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== new URL(request.url).origin) throw new Error("Use the connection form on this page.")
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Expected a JSON request.")
    const reader = request.body?.getReader()
    if (!reader) throw new Error("Enter connection details.")
    const chunks: Uint8Array[] = []; let length = 0
    try {
        while (true) {
            const part = await reader.read()
            if (part.done) break
            length += part.value.byteLength
            if (length > 2048) throw new Error("The connection details are too long.")
            chunks.push(part.value)
        }
    } finally { await reader.cancel().catch(() => {}) }
    let value
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new Error("Enter valid connection details.") }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter valid connection details.")
    return value
}
