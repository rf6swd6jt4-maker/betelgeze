import { MAX_ONBOARDING_UPLOAD_SIZE, getUploadKind, type StoredUpload } from "../onboarding/forms"

export const MAX_PORTAL_RESOURCE_SIZE = MAX_ONBOARDING_UPLOAD_SIZE
export type PortalResource = { id: string; name: string; size: number; type: string; createdAt: string }

export function portalResourceFile(value: unknown) {
    if (!value || typeof value !== "object") return null
    const file = value as Record<string, unknown>
    if (typeof file.name !== "string" || !file.name.trim() || file.name.length > 240 || /[\x00-\x1f\x7f]/u.test(file.name)
        || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PORTAL_RESOURCE_SIZE) return null
    const type = typeof file.type === "string" && file.type ? file.type : "application/octet-stream"
    if (type.length > 180 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u.test(type)) return null
    return { name: file.name.trim(), size: file.size, type }
}

export function portalResourceUpload(value: unknown, prefix: string): StoredUpload | null {
    const file = portalResourceFile(value)
    if (!file || !value || typeof value !== "object") return null
    const raw = value as Record<string, unknown>
    if (typeof raw.path !== "string" || !raw.path.startsWith(prefix) || raw.path.slice(prefix.length).includes("/") || typeof raw.receipt !== "string" || raw.provider !== "r2") return null
    return { ...file, path: raw.path, receipt: raw.receipt, provider: "r2", kind: getUploadKind(file.type) }
}

export function resourceSizeLabel(bytes: number) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}
