export type NativeWorkspaceRoute = {
    kind: "relationships" | "assets" | "work-items" | "work" | "admin" | "appointment-setting"
    relationshipId?: string
    section?: "work" | "okrs" | "okr-detail" | "maintenance" | "activity" | "activity-detail"
    key: string
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function nativeWorkspaceRoute(value: string, workspaceSlug: string): NativeWorkspaceRoute | null {
    let url: URL
    try { url = new URL(value, "http://workspace.invalid") } catch { return null }
    const path = url.pathname.replace(/\/$/, "")
    if (!path.startsWith(`/${workspaceSlug}/`)) return null
    const segments = path.slice(workspaceSlug.length + 2).split("/")
    const kind = segments[0]
    if (kind === "admin") {
        const section = segments[1] ?? "work"
        if (!["work", "okrs", "maintenance", "activity"].includes(section) || segments.length > 3) return null
        const id = segments[2]
        if (id && (!uuid.test(id) || (section !== "okrs" && section !== "activity"))) return null
        const filtered = new URLSearchParams()
        if (section === "activity" && !id) for (const field of ["category", "level", "range", "cursor"]) {
            const entry = url.searchParams.get(field)
            if (entry) filtered.set(field, entry)
        }
        return { kind, relationshipId: id, section: id ? section === "okrs" ? "okr-detail" : "activity-detail" : section as NativeWorkspaceRoute["section"], key: path + (filtered.size ? `?${filtered}` : "") }
    }
    if (kind !== "relationships" && kind !== "assets" && kind !== "work-items" && kind !== "work" && kind !== "appointment-setting") return null
    if (segments.length === 1) return { kind, key: path }
    if (segments.length === 2 && uuid.test(segments[1])) return { kind, relationshipId: segments[1], key: path }
    return null
}

export function workspaceNativePanelsEnabled(workspaceId: string, setting: string | undefined) {
    return setting === "all" || Boolean(setting?.split(",").map((value) => value.trim()).includes(workspaceId))
}
