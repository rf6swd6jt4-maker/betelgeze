import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { createWorkspacePerformanceMeasurement, type WorkspacePerformanceBoundary, type WorkspacePerformanceCommand } from "@/lib/workspace-performance-contract"

/** Same content-free schema as browser measurements. No message/account IDs,
 * URLs, bodies, endpoints or exception text are recorded. No extra DB writes.
 * Server durations start at handler/worker entry, not the user's send click.
 */
export function beginChatServerMeasurement(command: WorkspacePerformanceCommand) {
    return createWorkspacePerformanceMeasurement({ sampleId: randomUUID(), operation: "command", command,
        routeSection: "communications", cacheState: "network", renderer: "unknown", background: true,
    }, () => performance.now(), false)
}
const current = new AsyncLocalStorage<ReturnType<typeof beginChatServerMeasurement>>()
export function markChatBoundary(boundary: WorkspacePerformanceBoundary) { current.getStore()?.mark(boundary) }

export function withChatPerformance<R extends Request, C>(command: WorkspacePerformanceCommand, handler: (request: R, context: C) => Promise<Response>) {
    return (request: R, context: C) => {
        const measurement = beginChatServerMeasurement(command)
        return current.run(measurement, async () => {
            try {
                const response = await handler(request, context)
                const boundary = command === "message.receive" || command === "message.unread" ? "data_ready" : "server_ack"
                if (response.ok) measurement.mark(boundary)
                const sample = measurement.finish(response.ok ? "completed" : "failed", response.ok ? boundary : undefined)
                if (sample) {
                    response.headers.set("Server-Timing", Object.entries(sample.boundaries).map(([name, value]) => `${name};dur=${value}`).concat(`total;dur=${sample.durationMs}`).join(", "))
                    after(() => { console.info("Chat performance", sample) })
                }
                return response
            } catch (error) {
                const sample = measurement.finish("failed")
                if (sample) after(() => { console.info("Chat performance", sample) })
                throw error
            }
        })
    }
}
