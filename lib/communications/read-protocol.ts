export type CommunicationReadProtocol = "account-v1" | "device-v1"
export const COMMUNICATION_READ_PROTOCOL_QUERY = "readProtocol"
const slot = Symbol.for("betelgeze:communications-read-protocol:v1")
type ProtocolScope = { workspaceSlug?: string; workspaceId: string; userId: string; readProtocol: CommunicationReadProtocol }
type ProtocolHost = Window & { [slot]?: ProtocolScope }

/** A mounted shell owns its protocol. New children cannot promote an old shell. */
export function negotiatedCommunicationReadProtocol(scope: Pick<ProtocolScope, "workspaceId" | "userId">, fallback: CommunicationReadProtocol, hostScope: ProtocolScope | undefined, hosted: boolean): CommunicationReadProtocol {
    if (!hosted) return fallback
    return hostScope?.workspaceId === scope.workspaceId && hostScope.userId === scope.userId ? hostScope.readProtocol : "account-v1"
}
function documentProtocolScope(host: ProtocolHost): ProtocolScope | undefined {
    const element = host.document?.querySelector("[data-communications-read-protocol]")
    const readProtocol = element?.getAttribute("data-communications-read-protocol")
    const workspaceId = element?.getAttribute("data-communications-workspace")
    const userId = element?.getAttribute("data-communications-user")
    const workspaceSlug = element?.getAttribute("data-communications-workspace-slug") ?? undefined
    return workspaceId && userId && (readProtocol === "account-v1" || readProtocol === "device-v1") ? { workspaceId, workspaceSlug, userId, readProtocol } : undefined
}
export function readCommunicationReadProtocol(workspaceId: string, userId: string, fallback: CommunicationReadProtocol): CommunicationReadProtocol {
    if (typeof window === "undefined") return fallback
    try {
        const host = (window.top ?? window) as ProtocolHost
        return negotiatedCommunicationReadProtocol({ workspaceId, userId }, fallback, host[slot] ?? documentProtocolScope(host), window.top !== window || document.body.dataset.workspaceTabsHosted === "true" || Boolean(document.querySelector("[data-workspace-shell-root]")))
    } catch { return "account-v1" }
}
export function publishCommunicationReadProtocol(scope: ProtocolScope) {
    const host = window as ProtocolHost
    host[slot] = scope
    return () => { if (host[slot] === scope) delete host[slot] }
}

export function hostedCommunicationReadProtocol(workspaceSlug: string): CommunicationReadProtocol {
    if (typeof window === "undefined") return "account-v1"
    try {
        const host = (window.top ?? window) as ProtocolHost
        const scope = host[slot] ?? documentProtocolScope(host)
        return scope?.workspaceSlug === workspaceSlug ? scope.readProtocol : "account-v1"
    } catch { return "account-v1" }
}
