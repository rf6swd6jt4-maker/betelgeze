"use client"

import { useEffect, useState, type ReactNode } from "react"

export type PhoneBarItem = {
    key: string; label: string; icon: ReactNode; onSelect: () => void
    /** The destination in front of the person. */
    active?: boolean
    /** For an item that opens a drawer instead of a destination: whether it is open. */
    expanded?: boolean
    badge?: ReactNode
}

const PHONE_QUERY = "(max-width: 767px)"
// A visual viewport this much shorter than the window means the on-screen keyboard is up.
const KEYBOARD_GAP = 120

/**
 * The Today layout's phone navigation: a fixed bar under the work area, below `md` only. It reserves its height from
 * the work area through `body[data-workspace-phone-bar]` (globals.css), and gives it back while the on-screen keyboard
 * is up. An open phone conversation is its own full-screen layer and hides the bar in CSS; this component never touches
 * the conversation, its geometry owner or the reader. It never navigates on its own: every item calls the shell.
 */
export function PhoneBottomBar({ items }: { items: PhoneBarItem[] }) {
    const [keyboard, setKeyboard] = useState(false)
    useEffect(() => {
        const viewport = window.visualViewport
        if (!viewport) return
        const update = () => setKeyboard(window.innerHeight - viewport.height > KEYBOARD_GAP)
        update()
        viewport.addEventListener("resize", update)
        return () => viewport.removeEventListener("resize", update)
    }, [])
    useEffect(() => {
        // Named on the body only while the bar is really on screen, so no space is reserved for a hidden bar.
        const phone = window.matchMedia(PHONE_QUERY)
        const apply = () => {
            if (phone.matches && !keyboard) document.body.dataset.workspacePhoneBar = "shown"
            else delete document.body.dataset.workspacePhoneBar
        }
        apply()
        phone.addEventListener("change", apply)
        return () => { phone.removeEventListener("change", apply); delete document.body.dataset.workspacePhoneBar }
    }, [keyboard])

    return <nav data-workspace-bottom-bar aria-label="Main" hidden={keyboard}
        className="fixed inset-x-0 bottom-0 z-[52] h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] text-white md:hidden">
        <ul className="grid h-14 auto-cols-fr grid-flow-col">
            {items.map(item => {
                const on = item.active || item.expanded
                return <li key={item.key} className="min-w-0">
                    <button type="button" data-icon-button data-phone-bar-item={item.key} onClick={event => { event.currentTarget.focus({ preventScroll: true }); item.onSelect() }}
                        aria-current={item.active ? "page" : undefined} aria-expanded={item.expanded}
                        className={`relative flex h-14 w-full flex-col items-center justify-center gap-1 text-xs outline-none focus-visible:bg-white/[0.06] ${on ? "font-semibold text-white" : "text-neutral-400"}`}>
                        <span className="relative flex h-5 items-center justify-center">{item.icon}{item.badge ? <span className="absolute -right-4 -top-1.5">{item.badge}</span> : null}</span>
                        <span className="max-w-full truncate px-1">{item.label}</span>
                    </button>
                </li>
            })}
        </ul>
    </nav>
}
