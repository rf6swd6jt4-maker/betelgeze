export type LocationScopedCompany = {
    id: string
    location_value?: string | null
}

export function selectBalancedValidatedCompanies<T extends { company: LocationScopedCompany }>(valid: T[], targetCount: number) {
    if (targetCount <= 0 || valid.length <= targetCount) return valid.slice(0, Math.max(0, targetCount))
    const byLocation = new Map<string, T[]>()
    const locationOrder: string[] = []
    for (const item of valid) {
        const location = item.company.location_value ?? "unknown"
        if (!byLocation.has(location)) {
            byLocation.set(location, [])
            locationOrder.push(location)
        }
        byLocation.get(location)?.push(item)
    }
    if (locationOrder.length <= 1) return valid.slice(0, targetCount)
    const selected: T[] = []
    const selectedIds = new Set<string>()
    while (selected.length < targetCount) {
        let addedThisRound = false
        for (const location of locationOrder) {
            const bucket = byLocation.get(location) ?? []
            const next = bucket.shift()
            if (!next || selectedIds.has(next.company.id)) continue
            selected.push(next)
            selectedIds.add(next.company.id)
            addedThisRound = true
            if (selected.length >= targetCount) break
        }
        if (!addedThisRound) break
    }
    if (selected.length >= targetCount) return selected
    for (const item of valid) {
        if (selectedIds.has(item.company.id)) continue
        selected.push(item)
        selectedIds.add(item.company.id)
        if (selected.length >= targetCount) break
    }
    return selected
}
