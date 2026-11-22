/**
 * Campaigns are released to listed people first: CAMPAIGNS_PILOT_USERS is a comma-separated list of user IDs, or
 * "all". Rollout selection only; every read and command still checks owner/admin access to the workspace.
 */
export function campaignsPilotEnabled(userId: string | null | undefined, setting: string | undefined = process.env.CAMPAIGNS_PILOT_USERS) {
    if (!userId || !setting?.trim()) return false
    if (setting.trim() === "all") return true
    return setting.split(",").map(value => value.trim()).includes(userId)
}
