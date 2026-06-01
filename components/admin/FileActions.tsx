"use client"

import { AdminCopyButton } from "@/components/admin/AdminCopyButton"

type FileActionsProps = {
    url: string | null
    fileName: string
}

export function FileActions({ url, fileName }: FileActionsProps) {
    async function shareFile() {
        if (!url) return

        if (navigator.share) {
            await navigator.share({
                title: fileName,
                url,
            })
            return
        }

        await navigator.clipboard.writeText(url)
    }

    if (!url) {
        return (
            <span className="text-xs text-neutral-500">
                Link unavailable
            </span>
        )
    }

    return (
        <div className="flex flex-wrap gap-2">
            <a
                href={url}
                download={fileName}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
            >
                Download
            </a>

            <button
                type="button"
                onClick={shareFile}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
            >
                Share
            </button>

            <AdminCopyButton value={url} label="Copy link" />
        </div>
    )
}
