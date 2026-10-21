import { fetchGhlCalendar, parseOwnerBinding } from "./ghl-calendar-provider"
import { GhlError } from "./ghl-provider"

type Rpc = (action: string, input: Record<string, unknown>) => Promise<unknown>
type Job = { relationshipId: string; calendarId: string; month: string; revision: string; leaseToken: string; mode: "refresh" | "hydrate"; locationId: string; privateToken: string; binding: unknown }

/** One durable range or ten hydration admissions per existing scheduler run. */
export async function refreshRequestedGhlCalendar(deps: { rpc: Rpc; fetchCalendar?: typeof fetchGhlCalendar }) {
    const result = await deps.rpc("claim", {}) as { job?: Job | null }
    const job = result?.job
    if (!job) return { refreshed: false, queued: 0 }
    const identity = { relationshipId: job.relationshipId, calendarId: job.calendarId, month: job.month, revision: job.revision, leaseToken: job.leaseToken }
    try {
        const outcome = job.mode === "hydrate"
            ? await deps.rpc("hydrate", identity)
            : await deps.rpc("finish", { ...identity, snapshot: await (deps.fetchCalendar ?? fetchGhlCalendar)({ locationId: job.locationId, privateToken: job.privateToken }, job.month, parseOwnerBinding(job.binding)) })
        if ((outcome as { accepted?: boolean })?.accepted !== true) throw new Error("Calendar work was not durably accepted.")
        return { refreshed: job.mode === "refresh", queued: Number((outcome as { queued?: number }).queued ?? 0) }
    } catch (error) {
        await deps.rpc("fail", { ...identity, error: error instanceof GhlError ? error.code : "unavailable" })
        return { refreshed: false, queued: 0, attention: true }
    }
}
