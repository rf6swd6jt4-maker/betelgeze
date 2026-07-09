export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
    return Response.json(
        {
            ok: false,
            error: "ClickUp bridge handling is disabled. Use relationship work items and assets instead.",
        },
        { status: 410 }
    )
}
