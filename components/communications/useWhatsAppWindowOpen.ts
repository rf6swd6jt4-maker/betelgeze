"use client"

import { useCallback, useSyncExternalStore } from "react"
import { WHATSAPP_SERVICE_WINDOW_MS, whatsappWindowIsOpen } from "@/lib/client-messages/whatsapp-window"

export function useWhatsAppWindowOpen(lastInboundAt: string | null, active: boolean) {
    const isOpen = useCallback(() => whatsappWindowIsOpen(lastInboundAt), [lastInboundAt])
    const subscribe = useCallback((notify: () => void) => {
        if (!active || !lastInboundAt) return () => {}
        const start = Date.parse(lastInboundAt)
        let timer: ReturnType<typeof setTimeout>
        function scheduleBoundary() {
            const now = Date.now()
            const next = now < start ? start : start + WHATSAPP_SERVICE_WINDOW_MS
            if (next > now) timer = setTimeout(() => {
                notify()
                scheduleBoundary()
            }, Math.min(next - now, 2_147_483_647))
        }
        scheduleBoundary()
        return () => clearTimeout(timer)
    }, [active, lastInboundAt])
    return useSyncExternalStore(subscribe, isOpen, isOpen)
}
