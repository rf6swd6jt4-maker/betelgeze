"use client"

import type { CommunicationReadProtocol } from "@/lib/communications/read-protocol"
import { useCommunicationsReadProtocol } from "./CommunicationsReadProtocol"
import { useEffect, useState } from "react"
import { subscribeUnreadSummary, type UnreadSnapshot } from "@/lib/communications/unread-broadcast"

export function useSharedUnreadSummary(workspaceId: string, userId: string, fallback?: CommunicationReadProtocol) {
    const readProtocol = useCommunicationsReadProtocol(workspaceId, userId, fallback)
    const [snapshot, setSnapshot] = useState<UnreadSnapshot | null>(null)
    useEffect(() => subscribeUnreadSummary(workspaceId, userId, setSnapshot), [workspaceId, userId])
    return snapshot?.workspaceId === workspaceId && snapshot.userId === userId && (snapshot.readProtocol ?? "account-v1") === readProtocol ? snapshot : null
}
