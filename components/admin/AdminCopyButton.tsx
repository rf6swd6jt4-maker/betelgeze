"use client"

import { useState } from "react"

type AdminCopyButtonProps = {
    value: string
    label?: string
    copiedLabel?: string
    className?: string
}

export function AdminCopyButton({
    value,
    label = "Copy",
    copiedLabel = "Copied",
    className,
}: AdminCopyButtonProps) {
    const [copied, setCopied] = useState(false)

    async function copyValue() {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
    }

    return (
        <button
            type="button"
            onClick={copyValue}
            className={
                className ??
                "rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
            }
        >
            {copied ? copiedLabel : label}
        </button>
    )
}
