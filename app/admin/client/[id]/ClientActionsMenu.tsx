"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"

type ClientActionsMenuProps = {
    onboardingPath: string
    onboardingUrl: string
    clearProgressAction: () => Promise<void>
}

export function ClientActionsMenu({
    onboardingPath,
    onboardingUrl,
    clearProgressAction,
}: ClientActionsMenuProps) {
    const [open, setOpen] = useState(false)
    const menuId = useId()
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
        function handleOtherDropdown(event: Event) {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }

        document.addEventListener("mousedown", handlePointerDown)
        document.addEventListener("keydown", handleKeyDown)
        window.addEventListener("betelgeze:dropdown-open", handleOtherDropdown)

        return () => {
            document.removeEventListener("mousedown", handlePointerDown)
            document.removeEventListener("keydown", handleKeyDown)
            window.removeEventListener("betelgeze:dropdown-open", handleOtherDropdown)
        }
    }, [menuId])

    function toggle() {
        setOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            return next
        })
    }

    async function copyLink() {
        await navigator.clipboard.writeText(onboardingUrl)
        setOpen(false)
        alert("Onboarding link copied.")
    }

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={toggle}
                className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-white hover:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/30"
                aria-label="Open client actions"
                aria-expanded={open}
                aria-haspopup="menu"
            >
                ⋯
            </button>

            {open && (
                <div
                    className="absolute right-0 z-20 mt-2 w-[calc(100vw-2rem)] max-w-56 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl"
                    role="menu"
                >
                    <Link
                        href={onboardingPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block min-h-10 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
                        role="menuitem"
                    >
                        Open onboarding
                    </Link>

                    <button
                        type="button"
                        onClick={copyLink}
                        className="block min-h-10 w-full px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                        role="menuitem"
                    >
                        Copy onboarding link
                    </button>

                    <form action={clearProgressAction}>
                        <FormPendingOverlay />

                        <button
                            className="block min-h-10 w-full px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-950/50"
                            role="menuitem"
                        >
                            Clear progress
                        </button>
                    </form>
                </div>
            )}
        </div>
    )
}
