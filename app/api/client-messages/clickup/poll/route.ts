export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
    return Response.json(
        {
            ok: false,
            error: "ClickUp polling is disabled. Relationship work now lives in Betelgeze.",
        },
        { status: 410 }
    )
}
