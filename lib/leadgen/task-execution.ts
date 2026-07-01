export async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
) {
    if (items.length === 0) return
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
    let nextIndex = 0
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex
            nextIndex += 1
            await worker(items[index], index)
        }
    }))
}

export function groupByKey<T>(items: T[], keyForItem: (item: T) => string) {
    const groups = new Map<string, T[]>()
    for (const item of items) {
        const key = keyForItem(item)
        const group = groups.get(key)
        if (group) group.push(item)
        else groups.set(key, [item])
    }
    return groups
}
