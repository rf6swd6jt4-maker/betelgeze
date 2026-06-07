import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

async function loadMediaResponse(request: Request, context: RouteContext) {
    const { path = [] } = await context.params
    const storagePath = path.join("/")

    if (!storagePath) {
        return {
            error: new Response("Missing media path", { status: 400 }),
        }
    }

    try {
        const signedUrl = await createPrivateUploadSignedUrl(storagePath)
        const range = request.headers.get("range")
        const mediaResponse = await fetch(signedUrl, {
            headers: range ? { Range: range } : undefined,
        })

        if (!mediaResponse.ok) {
            return {
                error: new Response("Media not found", {
                    status: mediaResponse.status,
                }),
            }
        }

        return {
            mediaResponse,
            headers: getMediaHeaders(mediaResponse, storagePath),
            status: mediaResponse.status,
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

function getSafeFileName(path: string) {
    const fileName = path.split("/").pop() ?? "whatsapp-media"

    return fileName.replace(/["\\]/g, "")
}

function getMediaHeaders(mediaResponse: Response, storagePath: string) {
    const headers = new Headers({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${getSafeFileName(storagePath)}"`,
        "Content-Type":
            mediaResponse.headers.get("content-type") ??
            "application/octet-stream",
        "Accept-Ranges": mediaResponse.headers.get("accept-ranges") ?? "bytes",
        "X-Content-Type-Options": "nosniff",
    })
    const contentLength = mediaResponse.headers.get("content-length")
    const contentRange = mediaResponse.headers.get("content-range")
    const etag = mediaResponse.headers.get("etag")
    const lastModified = mediaResponse.headers.get("last-modified")

    if (contentLength) headers.set("Content-Length", contentLength)
    if (contentRange) headers.set("Content-Range", contentRange)
    if (etag) headers.set("ETag", etag)
    if (lastModified) headers.set("Last-Modified", lastModified)

    return headers
}

export async function GET(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(_request, context)

    if (result.error) return result.error

    return new Response(result.mediaResponse.body, {
        headers: result.headers,
        status: result.status,
    })
}

export async function HEAD(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(_request, context)

    if (result.error) return result.error

    return new Response(null, {
        headers: result.headers,
        status: result.status,
    })
}
