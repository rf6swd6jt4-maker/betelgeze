export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
    return Response.json(
        {
            ok: false,
            error: "ClickUp outbound bridge messaging is disabled. Use relationship communications and assets instead.",
        },
        { status: 410 }
    )
}
