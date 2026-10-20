import { completeGhlAuthorization } from "@/lib/ghl-oauth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export async function GET(request: Request) {
    const query = new URL(request.url).searchParams
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
    try {
        if (query.getAll("state").length !== 1 || query.getAll("code").length > 1) throw new Error("Invalid callback")
        const destination = await completeGhlAuthorization(query.get("state") ?? "", query.get("code"), query.has("error"))
        return new Response(null, { status: 303, headers: { ...headers, Location: destination.toString() } })
    } catch {
        return new Response("This HighLevel connection attempt is unavailable or expired. Return to Betelgeze Client Connections and start again.", { status: 400, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } })
    }
}
