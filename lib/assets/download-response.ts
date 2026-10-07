import "server-only"
import { createPrivateResourceDownloadUrl } from "@/lib/onboarding/uploads"
import { assetAttachmentDisposition, assetDownloadFilename, downloadableAsset, MAX_ASSET_ARCHIVE_BYTES, uniqueAssetDownloadNames, type DownloadableAsset } from "./download"

export const assetDownloadHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }

function messageDownloadPath(asset: DownloadableAsset) {
    return `/api/client-messages/media/${asset.storage_path!.split("/").map(encodeURIComponent).join("/")}?download=${encodeURIComponent(assetDownloadFilename(asset))}`
}

/** The caller must first read the asset through current session RLS. */
export async function assetDownloadResponse(workspaceSlug: string, asset: DownloadableAsset, request: Request) {
    if (!downloadableAsset(asset)) return new Response("File not found", { status: 404, headers: assetDownloadHeaders })
    if (asset.source_kind === "message") return new Response(null, { status: 303, headers: { ...assetDownloadHeaders, Location: messageDownloadPath(asset) } })
    if (asset.native_kind === "sop_extracted_image") {
        // Keep the canonical image owner, including its provenance and access checks.
        const { GET } = await import("@/app/api/workspaces/[workspaceSlug]/sop-images/[assetId]/route")
        const image = await GET(request, { params: Promise.resolve({ workspaceSlug, assetId: asset.id }) })
        if (!image.ok) return image
        return new Response(image.body, { status: image.status, headers: { ...assetDownloadHeaders, "Content-Type": "application/octet-stream", "Content-Disposition": assetAttachmentDisposition(assetDownloadFilename(asset)), ...(image.headers.has("content-length") ? { "Content-Length": image.headers.get("content-length")! } : {}) } })
    }
    return new Response(null, { status: 303, headers: { ...assetDownloadHeaders, Location: await createPrivateResourceDownloadUrl(asset.storage_path!, assetDownloadFilename(asset)) } })
}

async function loadAssetDownloadStream(workspaceSlug: string, asset: DownloadableAsset, request: Request) {
    if (asset.source_kind === "message") {
        // Invoke the existing media owner directly: no copied conversation/key
        // policy, self-HTTP request, credentials forwarding, or read acknowledgement.
        const { GET } = await import("@/app/api/client-messages/media/[...path]/route")
        return GET(new Request(new URL(messageDownloadPath(asset), request.url), { signal: request.signal }), { params: Promise.resolve({ path: asset.storage_path!.split("/") }) })
    }
    const response = await assetDownloadResponse(workspaceSlug, asset, request)
    if (response.status !== 303) return response
    return fetch(response.headers.get("location")!, { cache: "no-store", signal: request.signal, redirect: "error" })
}

function discardDownloadResponse(response: Response) {
    // Next.js may retain the sibling of a teed fetch body. Never await its cancel.
    void response.body?.cancel().catch(() => undefined)
}

function assetDownloadStream(workspaceSlug: string, asset: DownloadableAsset, request: Request) {
    const { signal } = request
    signal.throwIfAborted()
    return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        // Some canonical media owners do not consume the caller's AbortSignal
        // while preparing headers. Bound our wait and dispose of any late body.
        void loadAssetDownloadStream(workspaceSlug, asset, request).then(response => {
            signal.removeEventListener("abort", onAbort)
            if (signal.aborted) { discardDownloadResponse(response); reject(signal.reason) }
            else resolve(response)
        }, error => { signal.removeEventListener("abort", onAbort); reject(error) })
    })
}

/** STORE mode, one upstream object at a time, with backpressure and cancellation. */
export async function assetArchiveResponse(workspaceSlug: string, assets: DownloadableAsset[], request: Request) {
    const { ZipWriter } = await import("@zip.js/zip.js/lib/zip-core-writer.js")
    const abort = new AbortController()
    const signal = AbortSignal.any([request.signal, abort.signal, AbortSignal.timeout(240_000)])
    const upstreamRequest = new Request(request, { signal })
    const names = uniqueAssetDownloadNames(assets)
    // Resolve the first source before sending ZIP headers, so its failures retain
    // an HTTP error instead of creating an apparently successful empty archive.
    let first: Response
    try { first = await assetDownloadStream(workspaceSlug, assets[0], upstreamRequest) }
    catch { return new Response("Could not download this asset. Please retry.", { status: 503, headers: assetDownloadHeaders }) }
    if (!first.ok || !first.body) {
        abort.abort(); discardDownloadResponse(first)
        return new Response("An asset is unavailable. Refresh the library and retry.", { status: 404, headers: assetDownloadHeaders })
    }
    let controller!: TransformStreamDefaultController<Uint8Array>
    const stream = new TransformStream<Uint8Array, Uint8Array>({ start(value) { controller = value } })
    const writer = new ZipWriter(stream.writable, { level: 0, zip64: true, bufferedWrite: false, useWebWorkers: false, signal })
    let total = 0
    const completion = (async () => {
        try {
            for (let index = 0; index < assets.length; index++) {
                signal.throwIfAborted()
                const source = index === 0 ? first : await assetDownloadStream(workspaceSlug, assets[index], upstreamRequest)
                if (!source.ok || !source.body) { discardDownloadResponse(source); throw new Error("An asset is unavailable. Retry the download.") }
                const expected = source.headers.get("content-length")
                const size = expected !== null ? Number(expected) : undefined
                if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || total + size > MAX_ASSET_ARCHIVE_BYTES)) { discardDownloadResponse(source); throw new Error("Download at most 500MB at once.") }
                let transferred = 0
                const bounded = source.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                    transform(chunk, output) {
                        total += chunk.byteLength; transferred += chunk.byteLength
                        if (total > MAX_ASSET_ARCHIVE_BYTES) throw new Error("Download at most 500MB at once.")
                        output.enqueue(chunk)
                    },
                    flush() { if (size !== undefined && transferred !== size) throw new Error("An asset download was incomplete. Retry the download.") },
                }), { signal })
                await writer.add(names[index], bounded, { uncompressedSize: size })
            }
            await writer.close()
        } catch (error) {
            abort.abort(error)
            controller.error(error)
        }
    })()
    // The task is tied to the consumed HTTP stream, never a background job.
    void completion
    const reader = stream.readable.getReader()
    const body = new ReadableStream<Uint8Array>({
        async pull(output) {
            try { const next = await reader.read(); if (next.done) output.close(); else output.enqueue(next.value) }
            catch (error) { output.error(error) }
        },
        cancel(reason) { abort.abort(reason); void reader.cancel(reason).catch(() => undefined) },
    })
    return new Response(body, { headers: { ...assetDownloadHeaders, "Content-Type": "application/zip", "Content-Disposition": assetAttachmentDisposition("Assets.zip") } })
}
