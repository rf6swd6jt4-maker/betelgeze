"use client"

import { ChatComposerInput } from "@/components/communications/ChatComposerInput"

import { useEffect, type ReactNode, type RefObject } from "react"
import { reportWorkspaceComposerFocus } from "@/lib/workspace-composer-viewport"

export function MessageComposer({
    textareaRef,
    draft,
    placeholder,
    disabled,
    sendDisabled,
    leadingActions,
    submitLabel = "Send message",
    submitIcon,
    onDraftChange,
    onBlur,
    onSend,
}: {
    textareaRef: RefObject<HTMLElement | null>
    draft: string
    placeholder: string
    disabled: boolean
    sendDisabled: boolean
    leadingActions: ReactNode
    submitLabel?: string
    submitIcon?: ReactNode
    onDraftChange: (value: string) => void
    onBlur?: () => void
    onSend: () => void
}) {
    useEffect(() => {
        const blurComposer = () => textareaRef.current?.blur()
        const blurComposerWhenHidden = () => {
            if (document.visibilityState === "hidden") blurComposer()
        }

        document.addEventListener("visibilitychange", blurComposerWhenHidden)
        window.addEventListener("pagehide", blurComposer)
        return () => {
            document.removeEventListener("visibilitychange", blurComposerWhenHidden)
            window.removeEventListener("pagehide", blurComposer)
        }
    }, [textareaRef])

    return <>
        <form
            data-workspace-mutation-scope="local"
            onSubmit={(event) => {
                event.preventDefault()
                if (!sendDisabled) onSend()
            }}
            className="mx-auto flex max-w-3xl touch-manipulation items-center gap-1.5 rounded-2xl border border-neutral-800 bg-black px-1.5 py-1.5 focus-within:border-neutral-600"
        >
            <div className="flex shrink-0 items-center -space-x-1">{leadingActions}</div>
            <ChatComposerInput
                inputRef={textareaRef}
                value={draft}
                onChange={onDraftChange}
                onSend={onSend}
                placeholder={placeholder}
                disabled={disabled}
                sendDisabled={sendDisabled}
                onFocus={() => reportWorkspaceComposerFocus(true)}
                onBlur={() => { reportWorkspaceComposerFocus(false); onBlur?.() }}
            />
            <button data-icon-button type="submit" disabled={sendDisabled} aria-label={submitLabel} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:bg-neutral-800 disabled:text-neutral-600 lg:h-9 lg:w-9">
                {submitIcon ?? <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg>}
            </button>
        </form>
        <p className="mx-auto mt-2 hidden max-w-3xl text-center text-[10px] text-neutral-600 lg:block">Enter to send · Shift+Enter for a new line · Lists: Enter for next item, twice to finish · Tab to indent</p>
    </>
}
