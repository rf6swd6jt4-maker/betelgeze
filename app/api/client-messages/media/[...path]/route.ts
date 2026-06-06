import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

export async function GET(_request: Request, context: RouteContext) {
    const { path = [] } = await context.params
    const storagePath = path.join("/")

    if (!storagePath) {
        return new Response("Missing media path", { status: 400 })
    }

    try {
        const signedUrl = await createUploadSignedUrl(storagePath)
        const mediaResponse = await fetch(signedUrl)

        if (!mediaResponse.ok) {
            return new Response("Media not found", {
                status: mediaResponse.status,
            })
        }

        return new Response(mediaResponse.body, {
            headers: {
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Type":
                    mediaResponse.headers.get("content-type") ??
                    "application/octet-stream",
            },
        })
    } catch (error) {
        return new Response(
            error instanceof Error ? error.message : "Could not load media",
            { status: 500 }
        )
    }
}
