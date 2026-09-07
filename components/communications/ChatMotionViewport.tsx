"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { observeChatViewportMotion } from "@/lib/chat-viewport-motion"

export function ChatMotionViewport({ children }: { children: ReactNode }) {
    const clip = useRef<HTMLDivElement>(null)
    const layer = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        if (clip.current && layer.current) return observeChatViewportMotion(clip.current, layer.current)
    }, [])
    return <div ref={clip} className="min-h-0 flex-1 overflow-clip" data-chat-motion-viewport>
        <div ref={layer} className="flex h-full min-h-0 flex-col" data-chat-motion-layer>{children}</div>
    </div>
}
