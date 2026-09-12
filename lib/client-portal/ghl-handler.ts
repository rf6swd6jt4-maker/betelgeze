import { randomUUID } from "node:crypto"
import { fetchGhlMetrics, GhlError, parseGhlCredentials, readGhlJson } from "./ghl-provider"
import { ghlErrorMessages, isGhlMetrics, type GhlSummary } from "./ghl-types"

type Access = { workspace: { id: string }; relationship: { id: string } }
type Dependencies = {
    resolve: (token: string) => Promise<Access | null>
    rpc: (params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
    fetchMetrics?: typeof fetchGhlMetrics
}
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers })

// Explicit projection: this is the only shape allowed to leave the server.
function summary(value: Record<string, unknown>): GhlSummary {
    return {
        connected: value.connected === true,
        locationId: typeof value.locationId === "string" ? value.locationId : null,
        locationName: typeof value.locationName === "string" ? value.locationName : null,
        metrics: isGhlMetrics(value.metrics) ? { contacts: value.metrics.contacts, opportunities: value.metrics.opportunities, open: value.metrics.open, won: value.metrics.won, lost: value.metrics.lost } : null,
        refreshedAt: typeof value.refreshedAt === "string" ? value.refreshedAt : null,
        error: typeof value.error === "string" ? ghlErrorMessages[value.error] ?? "The last refresh did not complete. Please try again." : null,
        busy: value.busy === true,
    }
}

export async function handlePortalGhl(request: Request, token: string, deps: Dependencies): Promise<Response> {
    let operationId: string | null = null
    let call: ((action: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null
    try {
        const access = await deps.resolve(token)
        if (!access) return reply({ error: "This connection is not available for this portal." }, 404)
        call = async (action, params = {}) => {
            const { data, error } = await deps.rpc({ p_session_token: token, p_workspace_id: access.workspace.id, p_action: action, ...params })
            if (error || !data || typeof data !== "object") throw new GhlError("storage")
            const result = data as Record<string, unknown>
            if (typeof result.failure === "string") throw new GhlError(result.failure)
            return result
        }
        if (request.method === "GET") return reply(summary(await call("read")))
        // Portal URLs are bearer credentials. Also reject cross-site browser writes and non-JSON bodies.
        if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Please use the connection form in this portal." }, 403)
        if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Expected a JSON request." }, 415)
        if (Number(request.headers.get("content-length") || 0) > 8192) return reply({ error: "The connection details are too long." }, 413)
        let body: Record<string, unknown>
        try { body = await readGhlJson(new Response(request.body), 8192) } catch { return reply({ error: "Enter valid connection details." }, 400) }
        if (body.action === "disconnect") return reply(summary(await call("disconnect")))
        if (body.action !== "connect" && body.action !== "refresh") return reply({ error: "Unknown connection action." }, 400)
        let credentials = body.action === "connect" ? parseGhlCredentials(body) : null
        if (body.action === "connect" && !credentials) return reply({ error: "Enter a valid Location ID and Private Integration Token." }, 400)
        operationId = randomUUID()
        const started = await call(body.action === "connect" ? "begin_connect" : "begin_refresh", { p_operation_id: operationId })
        if (body.action === "refresh") credentials = parseGhlCredentials(started)
        if (!credentials) throw new GhlError("credentials")
        const result = await (deps.fetchMetrics ?? fetchGhlMetrics)(credentials)
        const saved = await call("finish", { p_operation_id: operationId, p_location_id: credentials.locationId, p_private_token: body.action === "connect" ? credentials.privateToken : null, p_location_name: result.locationName, p_metrics: result.metrics })
        operationId = null
        return reply(summary(saved))
    } catch (error) {
        const code = error instanceof GhlError ? error.code : "storage"
        if (operationId && call) await call("fail", { p_operation_id: operationId, p_error: ["credentials", "permissions", "location", "rate_limit", "response", "unavailable"].includes(code) ? code : "unavailable" }).catch(() => {})
        return reply({ error: ghlErrorMessages[code] ?? "The connection could not be loaded or saved. Please reload its status and try again." }, ["busy", "changed"].includes(code) ? 409 : ["cooldown", "rate_limit"].includes(code) ? 429 : code === "access" ? 404 : 503)
    }
}
