/** Stop composer drags from panning the keyboard's visual viewport on iOS. */
export function containComposerTouch(surface: HTMLElement) {
    let previousY: number | null = null
    let scrollable: HTMLElement | null = null
    let selecting = false
    let editorGesture = false
    const hasEditorSelection = () => {
        const doc = surface.ownerDocument
        const editor = doc.activeElement
        if (!editor?.matches("[data-chat-composer], textarea") || !surface.contains(editor)) return false
        if (editor.tagName === "TEXTAREA") {
            const input = editor as HTMLTextAreaElement
            return input.selectionStart !== input.selectionEnd
        }
        const selection = doc.getSelection()
        return !!selection && !selection.isCollapsed && !!selection.anchorNode && !!selection.focusNode &&
            editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)
    }
    const startsInEditor = (event: TouchEvent) => {
        const editor = surface.ownerDocument.activeElement
        if (!editor?.matches("[data-chat-composer], textarea") || !surface.contains(editor)) return false
        const target = event.target as HTMLElement | null
        if (target?.closest?.("button, a, [role=button]")) return false
        const host = target?.closest?.("[data-chat-composer-host], [data-chat-composer], textarea")
        if (host?.contains(editor)) return true
        // iOS can retarget native selection handles to the surrounding footer.
        // Keep a small hit area around the editor, not the entire footer/tray.
        if (!hasEditorSelection() || target?.closest?.("[data-composer-scroll]")) return false
        const rect = editor.getBoundingClientRect(), touch = event.touches[0]
        return touch.clientX >= rect.left - 24 && touch.clientX <= rect.right + 24 &&
            touch.clientY >= rect.top - 24 && touch.clientY <= rect.bottom + 24
    }
    const reset = () => { previousY = null; scrollable = null; selecting = false; editorGesture = false }
    const start = (event: TouchEvent) => {
        reset()
        if (event.touches.length !== 1) return
        previousY = event.touches[0].clientY
        editorGesture = startsInEditor(event)
        selecting = editorGesture && hasEditorSelection()
        const target = event.target as HTMLElement | null
        scrollable = target?.closest?.<HTMLElement>("textarea, [data-composer-scroll]") ?? null
    }
    const move = (event: TouchEvent) => {
        if (event.touches.length !== 1 || previousY === null) return
        const y = event.touches[0].clientY
        const delta = previousY - y
        previousY = y
        // Selection handles also emit touchmove, even on a one-line draft.
        // A long press may establish the range after touchstart. Once selection
        // owns the gesture, keep it native even when the handles cross/collapse.
        selecting ||= editorGesture && hasEditorSelection()
        if (selecting) return
        // Native scrolling is safe while a draft or sticker tray can consume the gesture.
        // At either edge (or for an empty draft), Safari otherwise pans the page.
        if (scrollable && scrollable.scrollHeight > scrollable.clientHeight && (
            (delta > 0 && scrollable.scrollTop < scrollable.scrollHeight - scrollable.clientHeight - 1) ||
            (delta < 0 && scrollable.scrollTop > 1)
        )) return
        if (event.cancelable) event.preventDefault()
    }
    surface.addEventListener("touchstart", start, { passive: true })
    surface.addEventListener("touchmove", move, { passive: false })
    surface.addEventListener("touchend", reset)
    surface.addEventListener("touchcancel", reset)
    return () => {
        surface.removeEventListener("touchstart", start)
        surface.removeEventListener("touchmove", move)
        surface.removeEventListener("touchend", reset)
        surface.removeEventListener("touchcancel", reset)
    }
}
