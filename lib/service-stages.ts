export const SERVICE_STAGES = [
    { key: "negotiating", label: "Negotiating", tone: "amber" },
    { key: "awaiting_payment", label: "Awaiting payment", tone: "yellow" },
    { key: "onboarding", label: "Onboarding", tone: "violet" },
    { key: "setup", label: "Setup", tone: "sky" },
    { key: "maintenance", label: "Maintenance", tone: "emerald" },
    { key: "completed", label: "Completed", tone: "neutral" },
    { key: "for_later", label: "For later", tone: "neutral" },
    { key: "declined", label: "Declined", tone: "neutral" },
] as const
export type ServiceStageKey = typeof SERVICE_STAGES[number]["key"]
export const serviceStageLabel = (stage: string | null) => SERVICE_STAGES.find(s => s.key === stage)?.label ?? "Review needed"
export type RelationshipServiceRow = {
    id: string; service_id: string; service_revision_id: string; name: string; stage: ServiceStageKey | null
    origin: string; assignee_user_id: string | null; assignee_name: string; version: number
    upfront_cents: number; recurring_cents: number; currency: string; created_at: string; legacy: boolean
}
export type ServiceValueSummary = { currency: string; kind: "catalogue_estimate" | "sold"; billing_interval: string | null; billing_interval_count: number | null; upfront_cents: number; recurring_cents: number }
export type RelationshipServicePage = { items: RelationshipServiceRow[]; hasMore: boolean; values?: ServiceValueSummary[] }
export type ServiceCatalogueChoice = { id: string; revision_id: string; name: string; description: string; upfront_cents: number; recurring_cents: number; currency: string }
export type RelationshipServiceSummary = { relationship_id: string; stages: ServiceStageKey[]; count: number; services: Array<{key: string; label: string}> }
export const isServiceStage = (value: unknown): value is ServiceStageKey => SERVICE_STAGES.some(s => s.key === value)
