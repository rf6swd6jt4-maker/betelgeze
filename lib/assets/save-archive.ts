/** Loaded only after an explicit Save ZIP as action. Never buffers the archive. */
export type ArchiveFileHandle = { createWritable: () => Promise<WritableStream<Uint8Array>> }

export async function saveAssetArchive({ href, file, signal, onSaving }: {
    href: string
    file: ArchiveFileHandle
    signal: AbortSignal
    onSaving: () => void
}) {
    const deadline = new AbortController()
    const timeout = setTimeout(() => deadline.abort(new DOMException("The save timed out. Try again.", "TimeoutError")), 240_000)
    const savingSignal = AbortSignal.any([signal, deadline.signal])
    let writable: WritableStream<Uint8Array> | undefined
    let response: Response | undefined
    try {
        savingSignal.throwIfAborted()
        // Obtain permission before requesting any bytes. A cancelled/denied picker
        // or destination must never start a redundant original/archive transfer.
        writable = await file.createWritable()
        savingSignal.throwIfAborted()
        response = await fetch(href, { signal: savingSignal, credentials: "same-origin", cache: "no-store", redirect: "error" })
        if (!response.ok) {
            throw new Error(response.status === 404 || response.status === 403
                ? "Some files are no longer available. Select files again."
                : response.status === 413 ? "Download up to 500 MB at once, or download large assets individually."
                    : "The ZIP could not be saved. Try again, or use Download.")
        }
        if (!response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "application/zip") {
            throw new Error("The ZIP could not be saved. Try again, or use Download.")
        }
        savingSignal.throwIfAborted()
        onSaving()
        // pipeTo applies backpressure, aborts on source/destination failure, and
        // resolves only after the destination closes successfully.
        await response.body.pipeTo(writable, { signal: savingSignal })
    } catch (error) {
        // Do not wait for a cancelled tee or a failed file destination to settle.
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
        if (writable && !writable.locked) void writable.abort().catch(() => undefined)
        if (savingSignal.aborted) throw savingSignal.reason
        throw error
    } finally {
        clearTimeout(timeout)
    }
}
