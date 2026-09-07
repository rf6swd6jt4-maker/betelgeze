import { useEffect, type KeyboardEvent, type RefObject } from "react"
import { chatListEdit } from "@/lib/chat-formatting"

function applyListEdit(textarea: HTMLTextAreaElement, key: "Enter" | "Tab", change: (value: string) => void, outdent = false) {
    const edit = chatListEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, key, outdent)
    if (!edit) return false
    if (textarea.maxLength >= 0 && edit.value.length > textarea.maxLength) return true
    change(edit.value)
    requestAnimationFrame(() => textarea.setSelectionRange(edit.start, edit.end))
    return true
}

export function handleChatListKey(event: KeyboardEvent<HTMLTextAreaElement>, change: (value: string) => void) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || (event.key !== "Enter" && event.key !== "Tab") || (event.key === "Enter" && event.shiftKey)) return false
    if (!applyListEdit(event.currentTarget, event.key, change, event.shiftKey)) return false
    event.preventDefault()
    return true
}

// Native beforeinput also covers mobile keyboards that omit Enter keydown.
export function useChatListInput(ref: RefObject<HTMLTextAreaElement | null>, change: (value: string) => void) {
    useEffect(() => {
        const textarea = ref.current
        if (!textarea) return
        let plainNewline = false
        const keydown = (event: globalThis.KeyboardEvent) => { plainNewline = event.key === "Enter" && event.shiftKey }
        const beforeinput = (event: InputEvent) => {
            const skip = plainNewline
            plainNewline = false
            if (!skip && event.cancelable && !event.isComposing && (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") && applyListEdit(textarea, "Enter", change)) event.preventDefault()
        }
        textarea.addEventListener("keydown", keydown)
        textarea.addEventListener("beforeinput", beforeinput)
        return () => {
            textarea.removeEventListener("keydown", keydown)
            textarea.removeEventListener("beforeinput", beforeinput)
        }
    })
}
