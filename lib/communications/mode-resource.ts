/** "leads": the Comms Leads tab, for people with Campaigns (docs/comms-leads.md). */
export type CommunicationsMode = "clients" | "team" | "leads"

/** The mode a Comms address opens: an explicit mode, else Team for a native conversation or DM, else Clients. */
export function communicationsModeFromQuery(query: { get(name: string): string | null | undefined }): CommunicationsMode {
    const mode = query.get("mode")
    if (mode === "leads") return "leads"
    return mode === "team" || (mode !== "clients" && Boolean(query.get("nativeConversation") || query.get("dm"))) ? "team" : "clients"
}

type ScopedBootstrap = { workspaceId: string; currentUser: { id: string }; conversations: unknown[] }

/** One request per mode for this panel, with retry and account/workspace fencing. */
export function createCommunicationsModeResource<T extends ScopedBootstrap>(input: {
    workspaceId: string
    userId: string
    load: (mode: CommunicationsMode, signal: AbortSignal) => Promise<T>
}) {
    const pending = new Map<CommunicationsMode, Promise<T>>()
    const controllers = new Set<AbortController>()
    let disposed = false
    return {
        load(mode: CommunicationsMode) {
            const existing = pending.get(mode)
            if (existing) return existing
            if (disposed) return Promise.reject(new Error("Conversation panel closed."))
            const controller = new AbortController()
            controllers.add(controller)
            const request = Promise.resolve().then(() => input.load(mode, controller.signal)).then((value) => {
                if (disposed || controller.signal.aborted) throw new Error("Conversation panel closed.")
                if (value.workspaceId !== input.workspaceId || value.currentUser?.id !== input.userId || !Array.isArray(value.conversations)) {
                    throw new Error("Your session changed. Reload Communications to continue.")
                }
                return value
            }).catch((error) => {
                pending.delete(mode)
                throw error
            }).finally(() => controllers.delete(controller))
            pending.set(mode, request)
            return request
        },
        dispose() {
            disposed = true
            controllers.forEach((controller) => controller.abort())
            controllers.clear()
            pending.clear()
        },
    }
}
