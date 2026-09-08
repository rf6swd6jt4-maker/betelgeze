"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"
import { createMessageLongPress } from "@/lib/communications/message-long-press"

export type MessageActionAnchor = { element: HTMLElement; point: { x: number; y: number } }

function messageActionAnchor(element: HTMLElement, point?: { clientX: number; clientY: number }): MessageActionAnchor {
    const rect = element.getBoundingClientRect()
    return { element, point: point ? { x: point.clientX - rect.left, y: point.clientY - rect.top } : { x: rect.width / 2, y: 0 } }
}

function isMessageControl(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("video,audio,button,a,input,textarea,select,[role='slider'],[data-message-control]"))
}

export function NativeMessageBubble({ video, image = false, selectingText = false, style, children, onOpenActions, ...props }: Omit<ComponentProps<"article">, "ref" | "onClick" | "onContextMenu" | "onKeyDown"> & { video: boolean; image?: boolean; selectingText?: boolean; onOpenActions: (anchor: MessageActionAnchor) => void }) {
    const [longPress] = useState(createMessageLongPress)
    const suppressClick = useRef(false)
    const lastTouchAt = useRef(0)
    useEffect(() => () => longPress.cancel(), [longPress])
    // Media metadata must never resize the surrounding bubble after paint.
    return <article {...props} role={selectingText ? undefined : "button"} data-message-bubble aria-haspopup={selectingText ? undefined : "menu"}
        style={{ ...style, ...(video ? { width: "min(35rem, 100%)" } : image ? { width: "min(22rem, 100%)" } : {}) }}
        // Native video controls retarget timeline touches to the video element.
        // Leave their default behavior alone and do not start a bubble gesture.
        onTouchStart={(event) => {
            lastTouchAt.current = Date.now()
            suppressClick.current = false
            longPress.cancel()
            if (selectingText) return
            if (event.touches.length !== 1) { props.onTouchCancel?.(event); return }
            if (isMessageControl(event.target)) return
            props.onTouchStart?.(event)
            const touch = event.touches[0]
            const anchor = messageActionAnchor(event.currentTarget, touch)
            longPress.start(touch.clientX, touch.clientY, () => {
                suppressClick.current = true
                // A held message must not also finish as a swipe-to-reply/delete.
                props.onTouchCancel?.(event)
                onOpenActions(anchor)
            })
        }}
        onTouchMove={(event) => {
            if (selectingText) return
            if (event.touches.length !== 1) { longPress.cancel(); props.onTouchCancel?.(event); return }
            const touch = event.touches[0]
            longPress.move(touch.clientX, touch.clientY)
            if (!suppressClick.current && !isMessageControl(event.target)) props.onTouchMove?.(event)
        }}
        onTouchEnd={(event) => {
            lastTouchAt.current = Date.now()
            longPress.cancel()
            if (selectingText) return
            if (!suppressClick.current && !isMessageControl(event.target)) props.onTouchEnd?.(event)
        }}
        onTouchCancel={(event) => {
            longPress.cancel()
            if (!isMessageControl(event.target)) props.onTouchCancel?.(event)
        }}
        onClickCapture={(event) => {
            if (suppressClick.current) {
                suppressClick.current = false
                event.preventDefault()
                event.stopPropagation()
                return
            }
            props.onClickCapture?.(event)
        }}
        onClick={(event) => {
            if (selectingText) return
            // Assistive technology activates with a zero-detail click rather than
            // a physical pointer click. Keep that non-pointer action accessible.
            if (event.detail === 0 && !isMessageControl(event.target)) onOpenActions(messageActionAnchor(event.currentTarget))
        }}
        onContextMenu={(event) => {
            if (selectingText) return
            if (isMessageControl(event.target)) return
            event.preventDefault()
            // Mobile browsers may emit contextmenu before or after touchend.
            // The hold timer owns touch activation; never open twice or after a swipe.
            const pointerType = (event.nativeEvent as PointerEvent).pointerType
            if (pointerType === "touch" || (pointerType !== "mouse" && Date.now() - lastTouchAt.current < 800)) return
            onOpenActions(messageActionAnchor(event.currentTarget, event))
        }}
        onKeyDown={(event) => {
            if (selectingText) return
            if (isMessageControl(event.target)) return
            if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault()
                onOpenActions(messageActionAnchor(event.currentTarget))
            }
        }}
    >{children}</article>
}
