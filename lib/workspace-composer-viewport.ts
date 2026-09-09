export const WORKSPACE_COMPOSER_FOCUS_EVENT = "betelgeze:workspace-composer-focus"

export type WorkspaceComposerFocusEventDetail = {
    focused: boolean
    sourceWindow: Window
}

export function focusedChatComposer(doc: Document): HTMLElement | null {
    const active = doc.activeElement
    return active?.matches("[data-chat-composer], textarea[data-chat-composer]") ? active as HTMLElement : null
}

export function reportWorkspaceComposerFocus(focused: boolean) {
    if (typeof window === "undefined") return
    const hostWindow = window.parent === window ? window : window.parent
    hostWindow.dispatchEvent(new CustomEvent<WorkspaceComposerFocusEventDetail>(WORKSPACE_COMPOSER_FOCUS_EVENT, {
        detail: { focused, sourceWindow: window },
    }))
}

export function closeWorkspaceComposer(composer: HTMLElement | null) {
    composer?.blur()
    // A focused element can be removed before React delivers its blur handler.
    // Always release the shell viewport so a hidden keyboard cannot leave the
    // conversation list constrained to the keyboard-open height.
    reportWorkspaceComposerFocus(false)
}
