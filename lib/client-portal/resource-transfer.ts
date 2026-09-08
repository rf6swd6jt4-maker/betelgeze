import { PORTAL_UPLOAD_PART_SIZE, portalResourceFile, type PortalResource } from "./resources"
import { folderArchive, type ResourceSelection } from "./resource-selection"
import type { ResourceUploadTicket } from "./resource-multipart"
import type { StoredUpload } from "@/lib/onboarding/forms"

export type TransferProgress = { state: "uploading" | "saving" | "waiting"; loaded: number; total: number }
class RequestError extends Error { constructor(message: string, readonly status = 0) { super(message) } }
const cancelled = () => new DOMException("Upload cancelled", "AbortError")

async function delay(ms: number, signal: AbortSignal) {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(cancelled()) }
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
        signal.addEventListener("abort", abort, { once: true })
    })
}

export async function retryTransfer<T>(operation: () => Promise<T>, signal: AbortSignal, waiting: () => void) {
    for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted()
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            waiting()
            await delay(1500, signal)
            attempt--
            continue
        }
        try { return await operation() } catch (error) {
            if (signal.aborted || (error as Error).name === "AbortError") throw cancelled()
            if (error instanceof RequestError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)) throw error
            if (attempt >= 4) throw error
            waiting()
            await delay(Math.min(8000, 750 * 2 ** attempt), signal)
        }
    }
}

export async function resourceRequest(api: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
    const result = await response.json()
    if (!response.ok) throw new RequestError(result.error || "The upload could not finish.", response.status)
    return result
}

export function putResourcePart(url: string, body: Blob, signal: AbortSignal, progress: (bytes: number) => void, type?: string) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted()
        const xhr = new XMLHttpRequest()
        const abort = () => xhr.abort()
        const finish = (error?: Error) => { signal.removeEventListener("abort", abort); if (error) reject(error); else resolve() }
        xhr.open("PUT", url)
        xhr.timeout = 15 * 60 * 1000
        if (type) xhr.setRequestHeader("Content-Type", type)
        xhr.upload.onprogress = (event) => progress(event.loaded)
        xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new RequestError("The upload could not finish.", xhr.status === 403 ? 503 : xhr.status))
        xhr.onerror = xhr.ontimeout = () => finish(new RequestError("Connection interrupted."))
        xhr.onabort = () => finish(cancelled())
        signal.addEventListener("abort", abort, { once: true })
        xhr.send(body)
    })
}

// Each task retains only its current part. Successful parts survive retries while the page is open.
export class ResourceTransfer {
    private ticket?: ResourceUploadTicket
    private upload?: StoredUpload
    private uploaded = false
    private reader?: ReadableStreamDefaultReader<Uint8Array>
    private archiveComplete?: Promise<void>
    private remainder?: Uint8Array
    private part?: Blob
    private done = false
    private loaded = 0
    private partNumber = 1
    private archiveLifetime = new AbortController()
    constructor(readonly api: string, readonly id: string, readonly selection: ResourceSelection) {}

    private async nextPart(size: number): Promise<Blob | undefined> {
        if (this.selection.file) {
            return this.loaded < this.selection.file.size ? this.selection.file.slice(this.loaded, this.loaded + size) : undefined
        }
        if (!this.reader) {
            const archive = await folderArchive(this.selection.entries ?? [], this.archiveLifetime.signal)
            this.reader = archive.readable.getReader()
            this.archiveComplete = archive.completion
        }
        const chunks: Uint8Array<ArrayBuffer>[] = []
        let length = 0
        try {
            while (length < size) {
                if (!this.remainder?.length) {
                    if (this.done) break
                    const next = await this.reader.read()
                    this.done = next.done === true
                    this.remainder = next.value
                    if (this.done) { await this.archiveComplete; break }
                }
                if (!this.remainder?.length) continue
                const take = Math.min(size - length, this.remainder.length)
                // Copy only the bounded part, never the complete folder/archive.
                chunks.push(new Uint8Array(this.remainder.subarray(0, take)))
                length += take
                this.remainder = this.remainder.subarray(take)
            }
        } catch (error) {
            await this.resetArchive()
            throw error
        }
        return length ? new Blob(chunks) : undefined
    }

    async run(signal: AbortSignal, report: (progress: TransferProgress) => void): Promise<PortalResource> {
        const file = portalResourceFile(this.selection)
        if (!file) throw new Error("This selection exceeds the storage limit.")
        const notify = (state: TransferProgress["state"], extra = 0) => report({ state, loaded: this.loaded + extra, total: file.size })
        const retry = <T>(operation: () => Promise<T>) => retryTransfer(operation, signal, () => notify("waiting"))
        if (this.selection.file && file.size <= PORTAL_UPLOAD_PART_SIZE) {
            if (!this.uploaded) {
                await retry(async () => {
                    notify("uploading")
                    const prepared = await resourceRequest(this.api, { action: "prepare", file, requestId: this.id }, signal)
                    this.upload = prepared.storedUpload
                    await putResourcePart(prepared.uploadUrl, this.selection.file!, signal, (bytes) => notify("uploading", bytes), file.type)
                })
                this.uploaded = true
                this.loaded = file.size
            }
            notify("saving")
            return (await retry(() => resourceRequest(this.api, { action: "confirm", upload: this.upload }, signal))).resource
        }
        const api = `${this.api}/multipart`
        if (!this.ticket) this.ticket = (await retry(() => resourceRequest(api, { action: "start", file, folder: Boolean(this.selection.entries), requestId: this.id }, signal))).ticket
        while (true) {
            signal.throwIfAborted()
            notify("uploading")
            if (!this.part) this.part = await this.nextPart(this.ticket!.partSize)
            if (!this.part) break
            await retry(async () => {
                const { uploadUrl } = await resourceRequest(api, { action: "part", ticket: this.ticket, partNumber: this.partNumber, size: this.part!.size }, signal)
                await putResourcePart(uploadUrl, this.part!, signal, (bytes) => notify("uploading", bytes))
            })
            this.loaded += this.part.size
            this.partNumber++
            this.part = undefined
        }
        notify("saving")
        const result = await retry(() => resourceRequest(api, { action: "complete", ticket: this.ticket, size: this.loaded, partCount: this.partNumber - 1 }, signal))
        this.reader?.releaseLock()
        this.reader = undefined
        return result.resource
    }

    private async resetArchive() {
        this.archiveLifetime.abort()
        await this.reader?.cancel().catch(() => {})
        this.reader = undefined
        if (this.ticket) await resourceRequest(`${this.api}/multipart`, { action: "abort", ticket: this.ticket }, AbortSignal.timeout(5000)).catch(() => {})
        this.ticket = undefined
        this.remainder = undefined
        this.part = undefined
        this.done = false
        this.loaded = 0
        this.partNumber = 1
        this.archiveLifetime = new AbortController()
    }

    async cancel() { await this.resetArchive() }
}
