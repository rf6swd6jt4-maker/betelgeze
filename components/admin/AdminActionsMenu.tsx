"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

export function AdminActionsMenu() {
    const [open, setOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handlePointerDown(event: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setOpen(false)
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false)
            }
        }

        document.addEventListener("mousedown", handlePointerDown)
        document.addEventListener("keydown", handleKeyDown)

        return () => {
            document.removeEventListener("mousedown", handlePointerDown)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [])

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-700 text-white hover:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/30 sm:h-10 sm:w-10"
                aria-label="Open operational actions"
                aria-expanded={open}
                aria-haspopup="menu"
            >
                <span aria-hidden="true" className="flex items-center gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-current" />
                    <span className="h-1 w-1 rounded-full bg-current" />
                    <span className="h-1 w-1 rounded-full bg-current" />
                </span>
            </button>

            {open && (
                <div
                    className="absolute right-0 z-20 mt-2 w-[calc(100vw-2rem)] max-w-72 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl"
                    role="menu"
                >
                    <Link
                        href="/admin/new"
                        className="block min-h-11 px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-800"
                        role="menuitem"
                    >
                        Create manual client
                    </Link>

                    <Link
                        href="/admin/health"
                        className="block min-h-11 px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-800"
                        role="menuitem"
                    >
                        System health
                    </Link>
                </div>
            )}
        </div>
    )
}
