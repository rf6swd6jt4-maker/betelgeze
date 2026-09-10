/** Browser-safe labels shared with server loaders; no database imports. */
export const MAINTENANCE_CATEGORIES = ["services", "leadgen", "onboarding", "billing", "communications", "integrations", "system_health"] as const
export const ADMIN_ACTIVITY_CATEGORIES = ["onboarding", "services", "leadgen", "billing", "communications", "gantt", "integrations", "maintenance", "system"] as const
export function maintenanceCategoryLabel(category: typeof MAINTENANCE_CATEGORIES[number]) {
    if (category === "leadgen") return "Lead Gen"
    if (category === "system_health") return "System Health"
    return category.slice(0, 1).toUpperCase() + category.slice(1)
}

export function adminActivityCategoryLabel(category: typeof ADMIN_ACTIVITY_CATEGORIES[number]) {
    if (category === "leadgen") return "Lead Gen"
    return category.slice(0, 1).toUpperCase() + category.slice(1)
}
