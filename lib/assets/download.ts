export const MAX_ASSET_DOWNLOADS = 24
export const MAX_ASSET_ARCHIVE_BYTES = 500 * 1024 * 1024

export type DownloadableAsset = {
    id: string
    workspace_id: string
    storage_path: string | null
    source_kind: string
    native_kind: string | null
    title: string
    content_type?: string | null
    file_size?: number | null
}

export function downloadableAsset(asset: Pick<DownloadableAsset, "workspace_id" | "storage_path">) {
    const path = asset.storage_path
    return Boolean(asset.workspace_id && path?.startsWith(`${asset.workspace_id}/`) && !path.includes("\\") && !path.split("/").some(part => !part || part === "." || part === ".."))
}

export function assetDownloadHref(workspaceSlug: string, asset: DownloadableAsset) {
    return downloadableAsset(asset) ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/${encodeURIComponent(asset.id)}/download` : null
}

export function assetArchiveHref(workspaceSlug: string, ids: string[]) {
    return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets/download?ids=${ids.map(encodeURIComponent).join(",")}`
}

export function parseAssetDownloadIds(raw: string | null) {
    if (!raw || raw.length > MAX_ASSET_DOWNLOADS * 37) return null
    const ids = raw.split(",")
    if (ids.length > MAX_ASSET_DOWNLOADS || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) || new Set(ids).size !== ids.length) return null
    return ids
}

export function assetDownloadFilename(asset: Pick<DownloadableAsset, "title" | "storage_path" | "content_type">) {
    const clean = (value: string) => Array.from(value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+|\.+$/g, "").trim(), character => character.length === 1 && /[\ud800-\udfff]/.test(character) ? "_" : character).slice(0, 200).join("")
    const name = clean(asset.title) || "Asset"
    if (/\.[a-z0-9]{1,12}$/i.test(name)) return name
    const storedExtension = asset.storage_path?.split("/").pop()?.match(/\.([a-z0-9]{1,12})$/i)?.[1]
    const mimeExtension: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "application/pdf": "pdf", "application/zip": "zip", "text/plain": "txt", "text/csv": "csv", "video/mp4": "mp4", "audio/mpeg": "mp3", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" }
    const extension = storedExtension ?? mimeExtension[asset.content_type ?? ""]
    return extension ? `${name}.${extension}` : name
}

export function assetAttachmentDisposition(name: string) {
    const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_") || "Asset"
    const encoded = encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function uniqueAssetDownloadNames(assets: DownloadableAsset[]) {
    const used = new Set<string>()
    return assets.map(asset => {
        const base = assetDownloadFilename(asset)
        const dot = base.lastIndexOf(".")
        const stem = dot > 0 ? base.slice(0, dot) : base
        const extension = dot > 0 ? base.slice(dot) : ""
        let name = base
        for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${stem} (${suffix})${extension}`
        used.add(name.toLowerCase())
        return name
    })
}
