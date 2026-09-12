export type GalleryMediaMetadata = { kind?: "image" | "video"; size?: number | null; width?: number; height?: number }
const MIB = 1024 * 1024
export const GALLERY_MEMORY_BUDGET = 96 * MIB

/** Conservative admission estimate, not a claim about browser/decoder allocation. */
export function galleryMediaCost(item: GalleryMediaMetadata) {
    const bytes = Number.isFinite(item.size) && item.size! > 0 ? item.size! : 24 * MIB
    const pixels = item.width && item.height && item.width > 0 && item.height > 0 ? item.width * item.height * 4 : 24 * MIB
    return bytes + (item.kind === "video" ? Math.max(8 * MIB, pixels * 3) : pixels)
}

/** Per-open-viewer residency. One speculative original at a time, after active readiness. */
export function createGalleryMediaSession(items: GalleryMediaMetadata[], initialIndex: number, notify: () => void, budget = GALLERY_MEMORY_BUDGET) {
    let selected = initialIndex
    let enabled = true, disposed = false, buffering = false
    const resident = new Set([selected])
    const settled = new Set<number>()
    const attempted = new Set<number>()
    const visited = new Set([selected])
    const costs = items.map(galleryMediaCost)
    let pending: number | null = null
    let snapshot: { selected: number; resident: number[]; pending: number | null; enabled: boolean } = { selected, resident: [...resident], pending, enabled }
    const emit = () => { snapshot = { selected, resident: [...resident], pending, enabled }; notify() }
    const used = () => [...resident].reduce((sum, index) => sum + costs[index], 0)
    function cancelPending() {
        if (pending !== null && pending !== selected) resident.delete(pending)
        pending = null
    }
    function drain() {
        if (disposed || !enabled || buffering || !settled.has(selected) || pending !== null) return
        // Nearby items first; never evict something the user viewed for a speculative load.
        const candidates = items.map((_, index) => index).sort((a, b) => Math.abs(a - selected) - Math.abs(b - selected) || b - a)
        for (const index of candidates) {
            const item = items[index]
            if (resident.has(index) || attempted.has(index) || !item.size || item.size <= 0 || !item.width || !item.height) continue
            if (costs[index] + used() > budget) continue
            pending = index
            resident.add(index)
            return
        }
    }
    return {
        getSnapshot: () => snapshot,
        select(index: number) {
            if (disposed || index === selected || index < 0 || index >= items.length) return
            if (!resident.has(index)) settled.delete(index)
            selected = index
            buffering = false
            if (pending === index) pending = null // Promote the existing element; do not restart its request.
            else cancelPending()
            resident.delete(index); resident.add(index)
            visited.delete(index); visited.add(index)
            for (const victim of [...resident].sort((a, b) => Number(visited.has(a)) - Number(visited.has(b)))) {
                if (used() <= budget) break
                if (victim === index) continue
                resident.delete(victim); settled.delete(victim)
            }
            drain(); emit()
        },
        settle(index: number, success = true) {
            if (disposed || !resident.has(index)) return
            if (settled.has(index) && !(index === selected && buffering)) return
            if (index === selected) buffering = false
            settled.add(index)
            if (pending === index) pending = null
            if (!success) {
                attempted.add(index)
                if (index !== selected) { resident.delete(index); settled.delete(index) }
            }
            drain(); emit()
        },
        wait(index: number) {
            if (disposed || index !== selected || buffering) return
            buffering = true; cancelPending(); emit()
        },
        setEnabled(value: boolean) {
            if (disposed || enabled === value) return
            enabled = value
            if (!enabled) cancelPending()
            else drain()
            emit()
        },
        timeout(index: number) {
            if (disposed || pending !== index) return
            attempted.add(index); resident.delete(index); pending = null
            drain(); emit()
        },
        dispose() { disposed = true; resident.clear(); settled.clear(); pending = null },
    }
}
