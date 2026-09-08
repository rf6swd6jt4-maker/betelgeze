import { getUploadKind, type StoredUpload } from "../onboarding/forms"

// R2's object ceiling. Portal resources are independent of onboarding field limits.
export const MAX_PORTAL_RESOURCE_SIZE = 5 * 1024 ** 4 - 5 * 1024 ** 3
export const PORTAL_UPLOAD_PART_SIZE = 8 * 1024 ** 2
export type PortalResource = { id: string; name: string; size: number; type: string; createdAt: string }

export function portalResourceFile(value: unknown) {
    if (!value || typeof value !== "object") return null
    const file = value as Record<string, unknown>
    if (typeof file.name !== "string" || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PORTAL_RESOURCE_SIZE) return null
    const candidate = typeof file.type === "string" ? file.type.split(";", 1)[0].trim().toLowerCase() : ""
    const type = candidate.length <= 180 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(candidate) ? candidate : "application/octet-stream"
    // PostgreSQL text cannot contain NUL. Keep all other original filename characters.
    return { name: file.name.replace(/\0/g, "") || "Untitled file", size: file.size, type }
}

export function portalResourceUpload(value: unknown, prefix: string): StoredUpload | null {
    const file = portalResourceFile(value)
    if (!file || !value || typeof value !== "object") return null
    const raw = value as Record<string, unknown>
    if (typeof raw.path !== "string" || !raw.path.startsWith(prefix) || raw.path.slice(prefix.length).includes("/") || typeof raw.receipt !== "string" || raw.provider !== "r2") return null
    return { ...file, path: raw.path, receipt: raw.receipt, provider: "r2", kind: getUploadKind(file.type) }
}

export function resourceSizeLabel(bytes: number) {
    if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return bytes ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : "0 bytes"
}
