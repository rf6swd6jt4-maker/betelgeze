export const portalProgressStatuses = ["preparing", "in_progress", "in_review", "live", "complete"] as const
export type PortalProgressStatus = (typeof portalProgressStatuses)[number]
export type PortalLeadMode = "ghl" | "appointments" | "empty"

export type PortalAction = {
    id: string
    title: string
    status: "open" | "completed"
    completedAt: string | null
    updatedAt: string
}

export type PortalServiceProgress = {
    id: string
    serviceName: string
    status: PortalProgressStatus
    updatedAt: string
}

export type ClientPortalOverview = {
    hasFulfilment: boolean
    leadMode: PortalLeadMode
    actions: PortalAction[]
    progress: PortalServiceProgress[]
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function validDate(value: unknown) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

export function clientPortalOverview(value: unknown): ClientPortalOverview {
    const source = record(value) ?? {}
    const leadMode = source.leadMode === "ghl" || source.leadMode === "appointments" || source.leadMode === "empty" ? source.leadMode : "empty"
    const actions = Array.isArray(source.actions) ? source.actions.flatMap((candidate) => {
        const item = record(candidate)
        const updatedAt = validDate(item?.updatedAt)
        if (!item || typeof item.id !== "string" || typeof item.title !== "string" || !updatedAt || (item.status !== "open" && item.status !== "completed")) return []
        return [{ id: item.id, title: item.title, status: item.status, completedAt: validDate(item.completedAt), updatedAt } satisfies PortalAction]
    }) : []
    const progress = Array.isArray(source.progress) ? source.progress.flatMap((candidate) => {
        const item = record(candidate)
        const updatedAt = validDate(item?.updatedAt)
        if (!item || typeof item.id !== "string" || typeof item.serviceName !== "string" || !updatedAt || !portalProgressStatuses.includes(item.status as PortalProgressStatus)) return []
        return [{ id: item.id, serviceName: item.serviceName, status: item.status as PortalProgressStatus, updatedAt } satisfies PortalServiceProgress]
    }) : []
    return { hasFulfilment: source.hasFulfilment === true, leadMode, actions, progress }
}

export const progressLabels: Record<PortalProgressStatus, string> = {
    preparing: "Preparing",
    in_progress: "In progress",
    in_review: "In review",
    live: "Live / ongoing",
    complete: "Complete",
}
