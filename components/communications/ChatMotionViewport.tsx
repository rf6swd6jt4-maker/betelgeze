"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { observeChatViewportMotion } from "@/lib/chat-viewport-motion"
import { MOBILE_CONVERSATION_VISIBILITY_EVENT } from "@/lib/mobile-conversation-viewport"
import { observeMobileConversationMotion } from "@/lib/mobile-conversation-motion"

export function ChatMotionViewport({ children }: { children: ReactNode }) {
    const clip = useRef<HTMLDivElement>(null)
    const layer = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const viewport = clip.current, content = layer.current
        if (!viewport || !content) return
        const view = viewport.ownerDocument.defaultView!
        const mobile = view.matchMedia("(max-width: 1023px)")
        let releaseMotion: (() => void) | null = null
        let owner = ""
        let frame = 0
        const reconcile = () => {
            // Reparenting retains the editor. Only the layer below the header
            // changes its presentation owner; root geometry and focus do not.
            const next = viewport.closest("[data-mobile-conversation-surface]") ? "conversation"
                : viewport.closest("[data-mobile-comms-tab]") ? "resident" : "legacy"
            if (next === owner) return
            releaseMotion?.()
            owner = next
            releaseMotion = next === "conversation" ? observeMobileConversationMotion(viewport, content)
                : next === "legacy" ? observeChatViewportMotion(viewport, content) : null
        }
        const update = () => {
            reconcile()
            view.cancelAnimationFrame(frame)
            // A breakpoint event or ownership release can precede the parent's
            // layout effect that reparents the retained portal target.
            frame = view.requestAnimationFrame(() => { frame = 0; reconcile() })
        }
        view.addEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update)
        mobile.addEventListener("change", update)
        update()
        return () => {
            view.cancelAnimationFrame(frame)
            view.removeEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update)
            mobile.removeEventListener("change", update)
            releaseMotion?.()
        }
    }, [])
    return <div ref={clip} className="min-h-0 flex-1 overflow-clip" data-chat-motion-viewport>
        <div ref={layer} className="flex h-full min-h-0 flex-col" data-chat-motion-layer>{children}</div>
    </div>
}
