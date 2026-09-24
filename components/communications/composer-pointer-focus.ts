// Touch and pen activation belongs to release. Focusing on contact can start
// moving the editor before the native tap has completed (especially while the
// previous keyboard is dismissing). Never defer focus to a timer or a frame.
export function createComposerPointerFocus(focus: () => void, nativeFocus: () => boolean = () => false) {
    let tap: { id: number; x: number; y: number } | null = null
    function pointerdown(event: PointerEvent) {
        tap = null
        if (nativeFocus()) return
        if (!event.isPrimary || event.button !== 0) return
        if (event.pointerType === "mouse") { focus(); return }
        tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    function pointermove(event: PointerEvent) {
        if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) tap = null
    }
    function pointerup(event: PointerEvent) {
        const started = tap
        tap = null
        if (nativeFocus()) return
        if (started?.id === event.pointerId && Math.hypot(event.clientX - started.x, event.clientY - started.y) <= 8) focus()
    }
    function pointercancel() { tap = null }
    return { pointerdown, pointermove, pointerup, pointercancel }
}

/** The full-screen conversation resizes around the keyboard itself. Let native
 * tap/hold selection focus the editor, then retain focus without asking WebKit
 * to pan the document too. focusin follows the browser's initial focus request;
 * doing this on pointerup is earlier and a subsequent native tap can replace it.
 * Click also covers a native refocus of the already-active editor. Re-focusing
 * that same element preserves its native selection. No blur, scroll reset,
 * hidden editor, timer or viewport prediction is involved.
 */
export function retainNativeComposerFocus(editor: HTMLElement, enabled: () => boolean) {
    let retaining = false
    const retain = () => {
        if (retaining || !enabled() || editor.ownerDocument.activeElement !== editor) return
        retaining = true
        try { editor.focus({ preventScroll: true }) }
        finally { retaining = false }
    }
    editor.addEventListener("focusin", retain)
    editor.addEventListener("click", retain)
    return () => {
        editor.removeEventListener("focusin", retain)
        editor.removeEventListener("click", retain)
    }
}
