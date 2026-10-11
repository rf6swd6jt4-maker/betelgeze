"use client"

import { createContext, useContext, useState } from "react"
import { readCommunicationReadProtocol, type CommunicationReadProtocol } from "@/lib/communications/read-protocol"

export const CommunicationsReadProtocolContext = createContext<CommunicationReadProtocol | null>(null)
export function useCommunicationsReadProtocol(workspaceId: string, userId: string, fallback: CommunicationReadProtocol = "account-v1") {
    const inherited = useContext(CommunicationsReadProtocolContext)
    const scope = `${workspaceId}:${userId}`
    const [pinned, setPinned] = useState(() => ({ scope, readProtocol: readCommunicationReadProtocol(workspaceId, userId, fallback) }))
    if (pinned.scope !== scope) setPinned({ scope, readProtocol: readCommunicationReadProtocol(workspaceId, userId, fallback) })
    return inherited ?? (pinned.scope === scope ? pinned.readProtocol : readCommunicationReadProtocol(workspaceId, userId, fallback))
}
