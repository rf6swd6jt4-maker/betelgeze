import { requireWorkspacePanel } from "@/lib/workspace-access"
import { readGhlJson } from "@/lib/client-portal/ghl-provider"
import { beginMetaReportingMaintenance, commitMetaReportingCandidate, listMetaReportingCandidates, previewMetaReportingCandidate, readMetaReportingMaintenance } from "@/lib/client-connections/meta-ads-maintenance"

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
type Context = { params: Promise<{ workspaceSlug: string }> }

export async function GET(request: Request, context: Context) {
    try {
        const { workspaceSlug } = await context.params
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        const relationshipId = new URL(request.url).searchParams.get("relationship") ?? ""
        return Response.json(await readMetaReportingMaintenance({ workspaceId: workspace.id, userId: user.id, relationshipId }), { headers })
    } catch { return Response.json({ error: "This client reporting connection is unavailable." }, { status: 403, headers }) }
}

export async function POST(request: Request, context: Context) {
    try {
        if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin)) return Response.json({ error: "Use Client Connections to maintain reporting." }, { status: 403, headers })
        if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415, headers })
        const { workspaceSlug } = await context.params
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        const body = await readGhlJson(new Response(request.body), 8192)
        if (typeof body.relationshipId !== "string") throw new Error("Choose a client.")
        const identity = { workspaceId: workspace.id, userId: user.id, relationshipId: body.relationshipId }
        const revision = body.expectedRevision === null || typeof body.expectedRevision === "string" ? body.expectedRevision : undefined
        let result: unknown
        if (body.action === "begin" && revision !== undefined) result = await beginMetaReportingMaintenance(identity, revision, body.reconnect === true)
        else if (body.action === "accounts" && typeof body.candidateId === "string") result = await listMetaReportingCandidates(identity, body.candidateId)
        else if (body.action === "preview" && typeof body.candidateId === "string" && typeof body.accountId === "string") result = await previewMetaReportingCandidate(identity, body.candidateId, body.accountId)
        else if (body.action === "commit" && body.confirmed === true && revision !== undefined && typeof body.candidateId === "string" && typeof body.accountId === "string") result = await commitMetaReportingCandidate(identity, body.candidateId, body.accountId, revision)
        else throw new Error("Choose a valid reporting action.")
        return Response.json(result, { headers })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Reporting could not be updated." }, { status: 400, headers }) }
}
