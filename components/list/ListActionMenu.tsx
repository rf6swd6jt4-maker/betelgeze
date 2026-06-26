"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"

export type ListAction = {
    label: string
    href?: string
    action?: () => Promise<void> | void
    danger?: boolean
    external?: boolean
    confirmMessage?: string
}

const REMOVE_WARNING = "Remove this item from Betelgeze? This keeps the interface clean, but the action may not be reversible from this screen."

export function ListActionMenu({ actions, label = "Open item actions" }: { actions: Array<Partial<ListAction> | null | undefined | false>; label?: string }) {
    const [open, setOpen] = useState(false)
    const menuId = useId()
    const menuRef = useRef<HTMLDivElement>(null)
    const visibleActions = actions.filter((action): action is ListAction => {
        if (!action) return false
        return Boolean(action.label && (action.href || action.action))
    })

    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false)
        }
        const closeForOtherDropdown = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [menuId])

    if (visibleActions.length === 0) {
        return <span className="inline-flex h-10 w-10 items-center justify-center text-neutral-700">
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </span>
    }

    function toggle() {
        setOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            return next
        })
    }

    return <div ref={menuRef} className="relative shrink-0">
        <button type="button" onClick={toggle} aria-label={label} aria-expanded={open} aria-haspopup="menu" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 text-white hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/30">
            <span aria-hidden="true" className="flex items-center gap-0.5">
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
                <span className="h-1 w-1 rounded-full bg-current" />
            </span>
        </button>
        {open && <div role="menu" className="absolute right-0 z-30 mt-2 w-[calc(100vw-2rem)] max-w-52 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl">
            {visibleActions.map((item) => {
                const className = `block min-h-9 w-full px-3 py-2 text-left text-sm ${item.danger ? "text-red-300 hover:bg-red-950/40" : "text-neutral-200 hover:bg-neutral-900"}`
                if (item.href) {
                    return <Link key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined} className={className} role="menuitem" onClick={() => setOpen(false)}>
                        {item.label}
                    </Link>
                }
                return <form key={item.label} action={item.action}>
                    <button className={className} role="menuitem" onClick={(event) => {
                        const warning = item.confirmMessage ?? (item.danger ? REMOVE_WARNING : null)
                        if (warning && !window.confirm(warning)) event.preventDefault()
                        setOpen(false)
                    }}>
                        {item.label}
                    </button>
                </form>
            })}
        </div>}
    </div>
}
