/** Shell-owned, bounded scroll memory; never persisted across account/workspace lifetimes. */
export class WorkspaceTabScrollStore {
    private readonly positions = new Map<string, number>()
    private readonly capacity: number

    constructor(capacity = 128) { this.capacity = capacity }

    get(key: string) { return this.positions.get(key) ?? 0 }

    set(key: string, position: number) {
        if (!Number.isFinite(position)) return
        this.positions.delete(key)
        this.positions.set(key, Math.max(0, position))
        while (this.positions.size > Math.max(1, this.capacity)) this.positions.delete(this.positions.keys().next().value!)
    }

    clear() { this.positions.clear() }
}
