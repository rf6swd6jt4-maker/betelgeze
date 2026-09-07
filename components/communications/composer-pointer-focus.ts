// Touch and pen activation belongs to release. Focusing on contact can start
// moving the editor before the native tap has completed (especially while the
// previous keyboard is dismissing). Never defer focus to a timer or a frame.
export function createComposerPointerFocus(focus: () => void) {
    let tap: { id: number; x: number; y: number } | null = null
    function pointerdown(event: PointerEvent) {
        tap = null
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
        if (started?.id === event.pointerId && Math.hypot(event.clientX - started.x, event.clientY - started.y) <= 8) focus()
    }
    function pointercancel() { tap = null }
    return { pointerdown, pointermove, pointerup, pointercancel }
}
