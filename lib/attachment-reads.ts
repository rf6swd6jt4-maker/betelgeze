/** The page and its incoming cursor are one retained value, including on the last page. */
export function createAttachmentPageCache<T>(limit = 30) {
    const values = new Map<string, { page: T; cursor: string | null; at: number }>()
    return {
        get(key: string) { return values.get(key) },
        has(key: string) { return values.has(key) },
        delete(key: string) { return values.delete(key) },
        set(key: string, page: T, cursor: string | null) {
            values.delete(key); values.set(key, { page, cursor, at: Date.now() })
            while (values.size > limit) values.delete(values.keys().next().value!)
        },
    }
}

/** One bounded request per mounted, account/workspace/record-scoped lane. */
export function createAttachmentReadOwner<T>(fetchPage: (key: string, signal: AbortSignal) => Promise<T>, timeoutMs = 30_000) {
    let generation = 0
    let pending: { key: string; promise: Promise<T | undefined>; controller: AbortController } | undefined
    return {
        cancel() { generation++; pending?.controller.abort(); pending = undefined },
        read(key: string): Promise<T | undefined> {
            if (pending?.key === key) return pending.promise
            generation++; pending?.controller.abort()
            const current = generation, controller = new AbortController()
            let timer: ReturnType<typeof setTimeout> | undefined
            const deadline = new Promise<never>((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error("Attachments took too long to load. Retry when ready.")) }, timeoutMs)
                controller.signal.addEventListener("abort", () => { if (current !== generation) reject(new Error("Superseded attachment request")) }, { once: true })
            })
            const promise = Promise.race([fetchPage(key, controller.signal), deadline])
                .then(value => current === generation ? value : undefined)
                .catch(error => { if (current !== generation) return undefined; throw error })
                .finally(() => { clearTimeout(timer); if (current === generation) pending = undefined })
            pending = { key, promise, controller }
            return promise
        },
    }
}
