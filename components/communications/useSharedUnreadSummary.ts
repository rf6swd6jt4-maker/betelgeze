"use client"

import { useEffect, useState } from "react"
import { subscribeUnreadSummary, type UnreadSnapshot } from "@/lib/communications/unread-broadcast"

export function useSharedUnreadSummary(workspaceId: string, userId: string) {
    const [snapshot, setSnapshot] = useState<UnreadSnapshot | null>(null)
    useEffect(() => subscribeUnreadSummary(workspaceId, userId, setSnapshot), [workspaceId, userId])
    return snapshot?.workspaceId === workspaceId && snapshot.userId === userId ? snapshot : null
}
