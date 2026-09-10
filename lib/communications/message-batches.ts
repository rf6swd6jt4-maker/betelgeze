/** Keep PostgREST URLs and concurrency bounded when joining returned messages. */
export async function loadMessageMetadata<T>(ids: string[], load: (ids: string[]) => PromiseLike<T[]>): Promise<T[]> {
    const unique = [...new Set(ids)]
    const batches = Array.from({ length: Math.ceil(unique.length / 150) }, (_, index) => unique.slice(index * 150, (index + 1) * 150))
    const results: T[][] = []
    let next = 0
    async function worker() {
        while (next < batches.length) {
            const index = next++
            results[index] = await load(batches[index])
        }
    }
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker))
    return results.flat()
}
