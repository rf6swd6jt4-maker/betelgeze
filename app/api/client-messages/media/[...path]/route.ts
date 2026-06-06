import {
    createPrivateUploadSignedUrl,
    getPrivateUploadMetadata,
} from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

function getStoragePath(path: string[]) {
    return path.join("/")
}

function getNotFoundResponse(status: number) {
    return new Response("Media not found", { status })
}

async function loadMediaResponse(request: Request, context: RouteContext) {
    const { path = [] } = await context.params
    const storagePath = getStoragePath(path)

    if (!storagePath) {
        return {
            error: new Response("Missing media path", { status: 400 }),
        }
    }

    try {
        const signedUrl = await createPrivateUploadSignedUrl(storagePath)
        const mediaResponse = await fetch(signedUrl)

        if (!mediaResponse.ok) {
            console.warn("client_message_media_fetch_failed", {
                path: storagePath,
                status: mediaResponse.status,
                userAgent: request.headers.get("user-agent"),
            })

            return {
                error: getNotFoundResponse(mediaResponse.status),
            }
        }

        return {
            mediaResponse,
            headers: getMediaHeaders(mediaResponse),
        }
    } catch (error) {
        console.warn("client_message_media_fetch_error", {
            path: storagePath,
            error: error instanceof Error ? error.message : String(error),
            userAgent: request.headers.get("user-agent"),
        })

        return {
            error: new Response(
                error instanceof Error ? error.message : "Could not load media",
                { status: 500 }
            ),
        }
    }
}

async function loadMediaHeadResponse(request: Request, context: RouteContext) {
    const { path = [] } = await context.params
    const storagePath = getStoragePath(path)

    if (!storagePath) {
        return {
            error: new Response("Missing media path", { status: 400 }),
        }
    }

    try {
        const metadata = await getPrivateUploadMetadata(storagePath)

        return {
            headers: getMetadataHeaders(metadata),
        }
    } catch (error) {
        console.warn("client_message_media_head_error", {
            path: storagePath,
            error: error instanceof Error ? error.message : String(error),
            userAgent: request.headers.get("user-agent"),
        })

        return {
            error: getNotFoundResponse(404),
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

function getMetadataHeaders(
    metadata: Awaited<ReturnType<typeof getPrivateUploadMetadata>>
) {
    const headers = new Headers({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "Content-Type": metadata.ContentType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
    })

    if (metadata.ContentLength !== undefined) {
        headers.set("Content-Length", String(metadata.ContentLength))
    }
    if (metadata.ETag) headers.set("ETag", metadata.ETag)
    if (metadata.LastModified) {
        headers.set("Last-Modified", metadata.LastModified.toUTCString())
    }

    return headers
}

export async function GET(request: Request, context: RouteContext) {
    const result = await loadMediaResponse(request, context)

    if (result.error) return result.error

    return new Response(result.mediaResponse.body, {
        headers: result.headers,
    })
}

export async function HEAD(request: Request, context: RouteContext) {
    const result = await loadMediaHeadResponse(request, context)

    if (result.error) return result.error

    return new Response(null, {
        headers: result.headers,
    })
}
