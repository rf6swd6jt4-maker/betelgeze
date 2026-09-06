// The editor can retain historical assignments that are no longer visible.
// Only submit responsibilities for the current active-service list.
export function activeTeamServiceAssignments(
    services: ReadonlyArray<{ id: string }>,
    responsibilities: Readonly<Record<string, string>>,
    memberIds: readonly string[],
) {
    return services.flatMap(({ id: serviceId }) => {
        const userId = responsibilities[serviceId]
        return userId && memberIds.includes(userId) ? [{ serviceId, userId }] : []
    })
}
