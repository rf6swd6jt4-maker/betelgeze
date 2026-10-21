import { finishGhlConnection, GhlConnectionError, manageGhlCalendars, manageGhlNotifications, readGhlConnection, selectGhlLocation, startGhlConnection } from "@/lib/ghl-oauth/server"
import { readGhlJson } from "@/lib/client-portal/ghl-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
type Context = { params: Promise<{ workspaceSlug: string }> }
function failure(error: unknown) { return Response.json({ error: error instanceof GhlConnectionError ? error.message : "The HighLevel connection could not be completed. Please try again." }, { status: 400, headers }) }
export async function GET(request: Request, { params }: Context) {
    try {
        const query = new URL(request.url).searchParams, { workspaceSlug } = await params
        const result = query.get("action") === "calendars"
            ? await manageGhlCalendars(workspaceSlug, { action: "calendars", relationshipId: query.get("relationshipId"), expectedRevision: query.get("expectedRevision") })
            : query.get("action") === "notification_status"
            ? await manageGhlNotifications(workspaceSlug, { action: "notification_status", relationshipId: query.get("relationshipId"), expectedRevision: query.get("expectedRevision") })
            : await readGhlConnection(workspaceSlug)
        return Response.json(result, { headers })
    }
    catch (error) { return failure(error) }
}
export async function POST(request: Request, { params }: Context) {
    if (request.headers.get("origin") !== "https://app.betelgeze.com" || request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Use Client Connections to connect HighLevel." }, { status: 403, headers })
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415, headers })
    try {
        const { workspaceSlug } = await params, body = await readGhlJson(new Response(request.body), 8192)
        const result = body.action === "start" ? await startGhlConnection(workspaceSlug, body)
            : body.action === "save_calendars" ? await manageGhlCalendars(workspaceSlug, body)
            : body.action === "select" ? await selectGhlLocation(workspaceSlug, body.locationId)
                : body.action === "connect" ? await finishGhlConnection(workspaceSlug, body.calendarIds ?? body.calendarId)
                    : ["prepare_notifications", "enable_notifications", "disable_notifications"].includes(String(body.action)) ? await manageGhlNotifications(workspaceSlug, body) : null
        if (!result) throw new GhlConnectionError("Choose a connection step.")
        return Response.json(result, { headers })
    } catch (error) { return failure(error) }
}
