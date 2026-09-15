"use client"

import { forwardRef, useCallback, useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from "react"

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
    if (typeof ref === "function") ref(value)
    else if (ref) ref.current = value
}

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoGrowTextarea({ className = "", onInput, value, defaultValue, ...props }, forwardedRef) {
    const localRef = useRef<HTMLTextAreaElement>(null)
    const resize = useCallback(() => {
        const textarea = localRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        if (textarea.scrollHeight > 0) textarea.style.height = `${textarea.scrollHeight}px`
    }, [])

    useLayoutEffect(() => {
        resize()
        const dialog = localRef.current?.closest("dialog")
        if (!dialog || dialog.open) return
        // A closed native dialog has no measurable scroll height. Remeasure as
        // soon as showModal() moves it into the top layer, before its next paint.
        const observer = new MutationObserver(() => {
            if (!dialog.open) return
            resize()
            observer.disconnect()
        })
        observer.observe(dialog, { attributes: true, attributeFilter: ["open"] })
        return () => observer.disconnect()
    }, [defaultValue, resize, value])

    return <textarea
        {...props}
        ref={element => { localRef.current = element; setRef(forwardedRef, element) }}
        value={value}
        defaultValue={defaultValue}
        onInput={event => { resize(); onInput?.(event) }}
        className={`resize-none overflow-hidden ${className}`}
    />
})
