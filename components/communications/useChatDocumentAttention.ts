"use client"

import { useEffect, useState } from "react"

// Visibility alone remains true for an unfocused desktop window. Use the host
// document so moving focus between retained frames and app chrome is harmless.
export function chatDocumentHasAttention() {
    return document.visibilityState === "visible" && (window.top ?? window).document.hasFocus()
}

export function useChatDocumentAttention() {
    const [attention, setAttention] = useState({ visible: false, attentive: false })
    useEffect(() => {
        const host = window.top ?? window
        const update = () => {
            const visible = document.visibilityState === "visible"
            const attentive = chatDocumentHasAttention()
            setAttention(current => current.visible === visible && current.attentive === attentive ? current : { visible, attentive })
        }
        const leave = () => setAttention({ visible: false, attentive: false })
        update()
        document.addEventListener("visibilitychange", update)
        window.addEventListener("pageshow", update)
        window.addEventListener("pagehide", leave)
        host.addEventListener("focus", update)
        host.addEventListener("blur", update)
        return () => {
            document.removeEventListener("visibilitychange", update)
            window.removeEventListener("pageshow", update)
            window.removeEventListener("pagehide", leave)
            host.removeEventListener("focus", update)
            host.removeEventListener("blur", update)
        }
    }, [])
    return attention
}
