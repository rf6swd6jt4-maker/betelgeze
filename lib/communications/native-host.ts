import type { CommunicationsBootstrap } from "./types"
import type { NativeCommunicationsBootstrap } from "../teams/types"
import type { CommunicationsMode } from "./mode-resource"

export type CommunicationsLocation = {
    mode: CommunicationsMode
    conversationId?: string
    nativeConversationId?: string
    dmUserId?: string
}

export type NativeCommunicationsSnapshot = CommunicationsLocation & {
    clientBootstrap: CommunicationsBootstrap | null
    nativeBootstrap: NativeCommunicationsBootstrap | null
}

export function communicationsLocation(value: string, workspaceSlug: string): CommunicationsLocation | null {
    const url = new URL(value, "http://workspace.invalid")
    if (url.pathname.replace(/\/$/, "") !== `/${workspaceSlug}/communications`) return null
    const query = url.searchParams
    const conversationId = query.get("conversation") || undefined
    const nativeConversationId = query.get("nativeConversation") || undefined
    const dmUserId = query.get("dm") || undefined
    const mode = query.get("mode") === "team" || (query.get("mode") !== "clients" && Boolean(nativeConversationId || dmUserId)) ? "team" : "clients"
    return { mode, conversationId, nativeConversationId, dmUserId }
}

export class CommunicationsHostAccessError extends Error {}

/** Reuses the routed panel's authorized, active-mode-first bootstrap read. */
export async function readNativeCommunications(input: {
    url: string; workspaceSlug: string; workspaceId: string; userId: string; signal: AbortSignal
}): Promise<NativeCommunicationsSnapshot> {
    const location = communicationsLocation(input.url, input.workspaceSlug)
    if (!location) throw new Error("This Communications page is unavailable.")
    const query = new URLSearchParams()
    const selected = location.mode === "clients" ? location.conversationId : location.nativeConversationId
    if (selected) query.set("conversation", selected)
    if (location.mode === "team" && location.dmUserId) query.set("dm", location.dmUserId)
    const path = location.mode === "clients" ? "sync" : "native/conversations"
    const response = await fetch(`/api/workspaces/${encodeURIComponent(input.workspaceSlug)}/communications/${path}?${query}`, {
        cache: "no-store", credentials: "same-origin", signal: input.signal,
    })
    input.signal.throwIfAborted()
    if (response.redirected || [401, 403, 404, 409].includes(response.status)) throw new CommunicationsHostAccessError("Your Communications access changed. Reload the workspace to continue.")
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Could not load conversations. Please retry.")
    const bootstrap = await response.json() as CommunicationsBootstrap | NativeCommunicationsBootstrap
    input.signal.throwIfAborted()
    if (bootstrap.workspaceId !== input.workspaceId || bootstrap.workspaceSlug !== input.workspaceSlug || bootstrap.currentUser?.id !== input.userId || !Array.isArray(bootstrap.conversations)) {
        throw new CommunicationsHostAccessError("Your workspace session changed. Reload to continue.")
    }
    return { ...location, clientBootstrap: location.mode === "clients" ? bootstrap as CommunicationsBootstrap : null, nativeBootstrap: location.mode === "team" ? bootstrap as NativeCommunicationsBootstrap : null }
}
