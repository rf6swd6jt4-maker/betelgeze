/** Direct PUT with actual byte progress. 100% is reserved for server acceptance. */
export function uploadWithProgress(url: string, body: Blob, headers: Record<string, string>, signal: AbortSignal, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const abort = () => { xhr.abort(); finish(new DOMException("Upload cancelled", "AbortError")) }
        const finish = (error?: Error) => {
            signal.removeEventListener("abort", abort)
            xhr.upload.onprogress = null
            xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null
            if (error) reject(error)
            else resolve()
        }
        if (signal.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return }
        xhr.open("PUT", url)
        xhr.timeout = 10 * 60 * 1000
        for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
        let last = -1
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return
            const percent = Math.min(99, Math.floor(event.loaded / event.total * 100))
            if (percent !== last) { last = percent; onProgress(percent) }
        }
        xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("Could not upload attachment. Retry this file."))
        xhr.onerror = () => finish(new Error("Upload interrupted. Check your connection and retry."))
        xhr.ontimeout = () => finish(new Error("Upload timed out. Retry this file."))
        xhr.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"))
        signal.addEventListener("abort", abort, { once: true })
        xhr.send(body)
    })
}
