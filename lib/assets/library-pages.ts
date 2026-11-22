/** How many assets the Library shows first, and how many each Load more adds. */
export const WORKSPACE_ASSET_PAGE_SIZE = 24

type Positioned = { id: string; updated_at: string }
const newestFirst = (a: Positioned, b: Positioned) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/** One page from rows already in keyset order (newest change first, then id), read one past the page size. */
export function workspaceAssetPage<T extends Positioned>(rows: T[]) {
    const items = rows.slice(0, WORKSPACE_ASSET_PAGE_SIZE)
    const last = items.at(-1)
    return { items, next: rows.length > WORKSPACE_ASSET_PAGE_SIZE && last ? { at: last.updated_at, id: last.id } : null }
}

/**
 * The Library's first page out of an already loaded list, with the position its Load more continues from. The list is
 * put in the keyset order of the older-page read first, so equal timestamps neither repeat nor go missing between the
 * two reads.
 */
export function firstWorkspaceAssetPage<T extends Positioned>(assets: T[]) {
    return workspaceAssetPage([...assets].sort(newestFirst))
}
