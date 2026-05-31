"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

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
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClick(event: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setOpen(false)
            }
        }

        document.addEventListener("mousedown", handleClick)

        return () => {
            document.removeEventListener("mousedown", handleClick)
        }
    }, [])

    async function copyLink() {
        await navigator.clipboard.writeText(onboardingUrl)
        setOpen(false)
        alert("Onboarding link copied.")
    }

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="rounded-xl border border-neutral-700 px-4 py-3 text-sm font-medium text-white"
                aria-label="Open client actions"
            >
                ⋯
            </button>

            {open && (
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl">
                    <Link
                        href={onboardingPath}
                        className="block px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                        Open onboarding
                    </Link>

                    <button
                        type="button"
                        onClick={copyLink}
                        className="block w-full px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                        Copy onboarding link
                    </button>

                    <form action={clearProgressAction}>
                        <button className="block w-full px-4 py-3 text-left text-sm text-red-300 hover:bg-red-950/50">
                            Clear progress
                        </button>
                    </form>
                </div>
            )}
        </div>
    )
}