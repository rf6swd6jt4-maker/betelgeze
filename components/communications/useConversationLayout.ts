"use client"

import { useCallback, useLayoutEffect, type MutableRefObject, type RefObject, type Dispatch, type SetStateAction } from "react"
import { observeConversationLayout } from "@/components/communications/message-pane-observer"

export function useConversationLayout(
    paneRef: RefObject<HTMLDivElement | null>,
    followingLatest: MutableRefObject<boolean>,
    conversationId: string | null,
    active: boolean,
    setAtLatest: Dispatch<SetStateAction<boolean>>,
    setShowJump: Dispatch<SetStateAction<boolean>>,
) {
    // The surface can create its portal after the workspace has committed. Own
    // positioning through the DOM ref so that delayed and replacement panes
    // are initialized even when the selected conversation has not changed.
    const attachPane = useCallback((pane: HTMLDivElement | null) => {
        paneRef.current = pane
        if (!pane || !conversationId) return
        const dispose = observeConversationLayout(pane, followingLatest, (latest, away) => {
            setAtLatest(latest)
            setShowJump(away)
        })
        return () => {
            dispose()
            if (paneRef.current === pane) paneRef.current = null
        }
    }, [conversationId, followingLatest, paneRef, setAtLatest, setShowJump])
    useLayoutEffect(() => {
        if (active) paneRef.current?.dispatchEvent(new Event("conversation-visible"))
    }, [active, paneRef])
    return attachPane
}
