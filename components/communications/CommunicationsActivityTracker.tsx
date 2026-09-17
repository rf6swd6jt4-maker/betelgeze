"use client"

import { useEffect, useRef, useState } from "react"
import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { chatActivityIsActive, createChatActivitySequence } from "@/lib/push/activity"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"
import { CHAT_READING_VISIBILITY_EVENT } from "@/lib/communications/reading-visibility"

const HEARTBEAT_MS = 20_000

export function CommunicationsActivityTracker({ connectionState, conversationId, conversationKind, workspaceId, isReading }: {
    isReading: () => boolean
    connectionState: CommunicationsConnectionState
    conversationId: string | null
    conversationKind: "client" | "native"
    workspaceId: string
}) {
    const workspaceTabActive = useWorkspaceTabActive()
    const [sequence] = useState(() => createChatActivitySequence(crypto.randomUUID()))
    const context = { workspaceId, conversationId, conversationKind, connectionLive: connectionState === "live", workspaceTabActive, isReading }
    const contextRef = useRef(context)
    const publishRef = useRef<((transition: boolean, close?: boolean) => void) | null>(null)

    useEffect(() => {
        contextRef.current = { workspaceId, conversationId, conversationKind, connectionLive: connectionState === "live", workspaceTabActive, isReading }
        publishRef.current?.(true)
    }, [connectionState, conversationId, conversationKind, workspaceId, workspaceTabActive, isReading])

    useEffect(() => {
        // Retained iframe tabs share the top-level window's focus. Focus moving
        // from a composer to app chrome must not be confused with leaving the app.
        const host = window.top ?? window
        let lastState = ""
        const isActive = () => contextRef.current.isReading() && chatActivityIsActive(contextRef.current, document.visibilityState === "visible", host.document.hasFocus())
        const publish = (transition: boolean, close = false) => {
            const active = !close && isActive()
            const state = JSON.stringify([contextRef.current.workspaceId, contextRef.current.conversationKind, contextRef.current.conversationId, active])
            // New rows and acknowledgement renders need a visibility recheck,
            // not duplicate activity writes or duplicate recovery dispatches.
            if (transition && !close && state === lastState) return
            lastState = state
            const payload = JSON.stringify({ ...sequence(contextRef.current, active, transition), readingVersion: 3 })
            if (close && navigator.sendBeacon("/api/communications/activity", new Blob([payload], { type: "application/json" }))) return
            void fetch("/api/communications/activity", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
                keepalive: !active, signal: AbortSignal.timeout(8_000),
            }).catch(() => undefined)
        }
        publishRef.current = publish
        const reconcile = () => publish(true, !isActive())
        const close = () => publish(true, true)
        reconcile()
        const timer = window.setInterval(() => { if (isActive()) publish(false) }, HEARTBEAT_MS)
        document.addEventListener("visibilitychange", reconcile)
        window.addEventListener("pageshow", reconcile)
        window.addEventListener("pagehide", close)
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, reconcile)
        window.addEventListener(CHAT_READING_VISIBILITY_EVENT, reconcile)
        host.addEventListener("focus", reconcile)
        host.addEventListener("blur", reconcile)
        return () => {
            publishRef.current = null
            window.clearInterval(timer)
            document.removeEventListener("visibilitychange", reconcile)
            window.removeEventListener("pageshow", reconcile)
            window.removeEventListener("pagehide", close)
            window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, reconcile)
            window.removeEventListener(CHAT_READING_VISIBILITY_EVENT, reconcile)
            host.removeEventListener("focus", reconcile)
            host.removeEventListener("blur", reconcile)
            close()
        }
    }, [sequence])
    return null
}
