type BuilderVideoUploadOptions = {
    uploadUrl: string
    file: File
    onProgress: (percent: number) => void
}

/** Uploads directly to object storage and reports actual transferred bytes. */
export function uploadBuilderVideo({ uploadUrl, file, onProgress }: BuilderVideoUploadOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        let settled = false
        let lastProgress = -1

        const reportProgress = (percent: number) => {
            if (percent === lastProgress) return
            lastProgress = percent
            onProgress(percent)
        }

        const finish = (error?: Error) => {
            if (settled) return
            settled = true
            xhr.upload.onprogress = null
            xhr.onload = xhr.onerror = xhr.onabort = null
            if (error) reject(error)
            else resolve()
        }

        xhr.open("PUT", uploadUrl)
        xhr.setRequestHeader("Content-Type", file.type)
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || event.total <= 0) return
            // Storage acknowledgement, not bytes sent, is the completion boundary.
            reportProgress(Math.min(99, Math.floor(event.loaded / event.total * 100)))
        }
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                finish(new Error(`Video storage rejected the upload (HTTP ${xhr.status}). Try again; if it continues, check the R2 CORS configuration.`))
                return
            }
            reportProgress(100)
            finish()
        }
        xhr.onerror = () => finish(new Error("The video upload was interrupted. Check your connection and try again."))
        xhr.onabort = () => finish(new DOMException("Video upload cancelled", "AbortError"))
        reportProgress(0)
        xhr.send(file)
    })
}
