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
        textarea.style.height = `${textarea.scrollHeight}px`
    }, [])

    useLayoutEffect(resize, [defaultValue, resize, value])

    return <textarea
        {...props}
        ref={element => { localRef.current = element; setRef(forwardedRef, element) }}
        value={value}
        defaultValue={defaultValue}
        onInput={event => { resize(); onInput?.(event) }}
        className={`resize-none overflow-hidden [field-sizing:content] ${className}`}
    />
})
