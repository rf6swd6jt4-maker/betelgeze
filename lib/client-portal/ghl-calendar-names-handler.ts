import { randomUUID } from "node:crypto"
import { GhlError, parseGhlCredentials, readGhlJson } from "./ghl-provider"
import { fetchGhlCalendarNames } from "./ghl-calendar-names-provider"
import { projectCalendar } from "./ghl-calendar-handler"
import type { OwnerCalendarResult } from "./ghl-calendar-provider"
type Dependencies = {resolve: (token: string) => Promise<{workspace: {id: string}} | null>; rpc: (params: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>; fetchNames?: typeof fetchGhlCalendarNames}
const reply = (value: unknown, status = 200) => Response.json(value, {status, headers: {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"}})
export async function handlePortalGhlCalendarNames(request: Request, token: string, deps: Dependencies) {
    let op: string | null = null, call: ((action: string, extra?: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null
    try {
        const access = await deps.resolve(token)
        if (!access) return reply({error: "This calendar is not available for this portal."}, 404)
        if (request.headers.get("sec-fetch-site") === "cross-site") return reply({error: "Use the calendar in this portal."}, 403)
        if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({error: "Expected a JSON request."}, 415)
        let body: Record<string, unknown>
        try { body = await readGhlJson(new Response(request.body), 2048) } catch { return reply({error: "Invalid request."}, 400) }
        if (Object.keys(body).some(key => key !== "snapshotId") || typeof body.snapshotId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.snapshotId)) return reply({error: "Reload the calendar before updating names."}, 400)
        call = async (action, extra = {}) => {
            const {data, error} = await deps.rpc({p_session_token: token, p_workspace_id: access.workspace.id, p_action: action, p_snapshot_id: body.snapshotId, ...extra})
            if (error || !data || typeof data !== "object") throw new GhlError("storage")
            const value = data as Record<string, unknown>
            if (typeof value.failure === "string") throw new GhlError(value.failure)
            return value
        }
        op = randomUUID()
        const started = await call("begin", {p_operation_id: op})
        if (started.skipped) { op = null; return reply(projectCalendar(started)) }
        const credentials = parseGhlCredentials(started)
        if (!credentials) throw new GhlError("credentials")
        const labels = await (deps.fetchNames ?? fetchGhlCalendarNames)(credentials, started.snapshot as OwnerCalendarResult)
        const saved = await call("finish", {p_operation_id: op, p_labels: labels})
        op = null
        return reply(projectCalendar(saved))
    } catch (error) {
        const code = error instanceof GhlError ? error.code : "unavailable"
        if (op && call) await call("fail", {p_operation_id: op}).catch(() => {})
        return reply({error: "Contact details could not be updated. Original GHL titles are shown."}, ["changed", "busy", "cooldown"].includes(code) ? 409 : 503)
    }
}
