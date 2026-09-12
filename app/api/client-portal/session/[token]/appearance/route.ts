import { loadClientPortalStartupAppearance } from "@/lib/client-portal/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteProps = {
    params: Promise<{ token: string }>
}

export async function GET(_request: Request, { params }: RouteProps) {
    const { token } = await params
    const appearance = await loadClientPortalStartupAppearance(token)
    if (!appearance) return Response.json({ error: "Not found" }, {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
    })
    return Response.json(appearance, {
        headers: { "Cache-Control": "private, no-store" },
    })
}
