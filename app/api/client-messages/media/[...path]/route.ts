import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

async function loadMediaResponse(context: RouteContext) {
    const { path = [] } = await context.params
    const storagePath = path.join("/")

    if (!storagePath) {
        return {
            error: new Response("Missing media path", { status: 400 }),
        }
    }

    try {
        const signedUrl = await createPrivateUploadSignedUrl(storagePath)
        const mediaResponse = await fetch(signedUrl)

        if (!mediaResponse.ok) {
            return {
                error: new Response("Media not found", {
                    status: mediaResponse.status,
                }),
            }
        }

        return {
            mediaResponse,
            headers: getMediaHeaders(mediaResponse),
        }
    } catch (error) {
        return {
            error: new Response(
                error instanceof Error ? error.message : "Could not load media",
                { status: 500 }
            ),
        }
    }
}

function getMediaHeaders(mediaResponse: Response) {
    const headers = new Headers({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "Content-Type":
            mediaResponse.headers.get("content-type") ??
            "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
    })
    const contentLength = mediaResponse.headers.get("content-length")
    const etag = mediaResponse.headers.get("etag")
    const lastModified = mediaResponse.headers.get("last-modified")

    if (contentLength) headers.set("Content-Length", contentLength)
    if (etag) headers.set("ETag", etag)
    if (lastModified) headers.set("Last-Modified", lastModified)

    return headers
}

export async function GET(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(context)

    if (result.error) return result.error

    return new Response(result.mediaResponse.body, {
        headers: result.headers,
    })
}

export async function HEAD(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(context)

    if (result.error) return result.error

    return new Response(null, {
        headers: result.headers,
    })
}
