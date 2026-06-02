"use client"

import { useEffect, useRef, useState } from "react"
import { displayMessageAddress } from "@/lib/client-messages/addresses"

type ProfileMenuProps = {
    name: string | null
    email: string | null
    phone: string | null
}

export function ProfileMenu({ name, email, phone }: ProfileMenuProps) {
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

    const displayName = name?.trim() || "Client"
    const initials = displayName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-[#F8F7F3] text-sm font-semibold text-[#1E3A5F] transition hover:border-[#1E3A5F] focus:outline-none focus:ring-4 focus:ring-blue-100"
                aria-label="Show client profile"
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                {initials}
            </button>

            {open && (
                <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Client profile
                    </p>
                    <p className="mt-2 font-semibold text-slate-950">
                        {displayName}
                    </p>
                    <p className="mt-1 break-all text-sm text-slate-600">
                        {phone ? displayMessageAddress(phone) : "No phone saved"}
                    </p>
                    {email && (
                        <p className="mt-1 break-all text-xs text-slate-500">
                            {email}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
