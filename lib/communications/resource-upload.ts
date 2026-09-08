/** Only trusted portal upload events can expose an asset action in staff Comms. */
export function resourceUploadAssetId(payload: unknown): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
    const raw = payload as Record<string, unknown>
    return raw.source === "client_portal" && raw.kind === "resource_upload"
        && typeof raw.asset_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.asset_id)
        ? raw.asset_id : null
}
