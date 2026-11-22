/**
 * Campaigns are released to listed people first: CAMPAIGNS_PILOT_USERS is a comma-separated list of user IDs, or
 * "all". Rollout selection only; every read and command still checks owner/admin access to the workspace.
 */
export function campaignsPilotEnabled(userId: string | null | undefined, setting: string | undefined = process.env.CAMPAIGNS_PILOT_USERS) {
    if (!userId || !setting?.trim()) return false
    if (setting.trim() === "all") return true
    return setting.split(",").map(value => value.trim()).includes(userId)
}

/** The Comms Leads tab (docs/comms-leads.md): owners and admins who have Campaigns, like the Campaigns panel itself. */
export function leadsCommsEnabled(userId: string | null | undefined, role: string | null | undefined, setting?: string) {
    return (role === "owner" || role === "admin") && campaignsPilotEnabled(userId, setting ?? process.env.CAMPAIGNS_PILOT_USERS)
}
