import { getAal2User } from "@/lib/auth/aal"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { withSearchDeadline } from "@/lib/workspace-search-server"
import { CommunicationReferenceError, parseReferenceBatch, readCommunicationReferences, REFERENCE_UUID_PATTERN } from "@/lib/communications/references-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
const failure = (message: string, status: number) => Response.json({ error: message, results: [] }, { status, headers })

async function read(request: Request, context: { params: Promise<{ workspaceSlug: string }> }, resolve: boolean) {
    try {
        return await withSearchDeadline(request.signal, async signal => {
            const { workspaceSlug } = await context.params
            const user = await getAal2User(await createSupabaseServerClient())
            signal.throwIfAborted()
            if (!user) return failure("Sign in to view references.", 401)
            const url = new URL(request.url)
            const body = resolve ? await request.json().catch(() => null) as Record<string, unknown> | null : null
            const conversationId = resolve ? body?.conversationId : url.searchParams.get("conversationId")
            if (typeof conversationId !== "string" || !REFERENCE_UUID_PATTERN.test(conversationId)) return failure("A valid conversation is required.", 400)
            const common = { workspaceSlug, userId: user.id, conversationId, signal }
            if (resolve) {
                const references = parseReferenceBatch(body?.references)
                if (!references) return failure("A valid reference batch is required.", 400)
                return Response.json(await readCommunicationReferences({ ...common, references }), { headers })
            }
            const query = (url.searchParams.get("q") ?? "").trim()
            if (query.length > 100) return failure("Search query is too long.", 400)
            return Response.json(await readCommunicationReferences({ ...common, query }), { headers })
        }, 5_000)
    } catch (error) {
        if (error instanceof CommunicationReferenceError) return failure(error.message, error.status)
        return failure(error instanceof DOMException && error.name === "TimeoutError" ? "Reference search timed out." : "References are temporarily unavailable.", 503)
    }
}

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) { return read(request, context, false) }
/** Read-only batch resolution; POST keeps private record identities out of URLs. */
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) { return read(request, context, true) }
