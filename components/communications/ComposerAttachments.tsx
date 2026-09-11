"use client"

import Image from "next/image"
import { useSyncExternalStore } from "react"
import { Status } from "@/components/ui"
import type { AttachmentUploadQueue } from "@/lib/communications/attachment-upload-queue"

export function ComposerAttachments({ queue, conversationId }: { queue: AttachmentUploadQueue; conversationId: string }) {
    const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot).filter((item) => item.conversationId === conversationId)
    if (!items.length) return null
    return <div className="mx-auto mb-2 max-w-3xl" aria-label="Message attachments">
        <div data-composer-scroll className="flex gap-2 overflow-x-auto overscroll-contain pb-1">
            {items.map((item) => <div key={item.id} className="relative w-36 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-black">
                <div className="flex h-16 items-center justify-center bg-neutral-900">
                    {item.previewUrl ? <Image unoptimized src={item.previewUrl} alt={item.file.name} width={144} height={64} className="h-full w-full object-cover" /> : <span className="px-3 text-xs text-neutral-500">{item.file.type.startsWith("image/") ? "Image" : item.file.type.startsWith("video/") ? "Video" : "File"}</span>}
                </div>
                <button data-icon-button type="button" onClick={() => queue.remove(item.id)} disabled={item.locked} aria-label={`Remove ${item.file.name}`} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-lg text-white hover:bg-black disabled:opacity-30">×</button>
                <div className="px-2 py-2">
                    <p className="truncate text-xs text-neutral-200" title={item.file.name}>{item.file.name}</p>
                    <div className="mt-1 text-[10px]">
                        <Status label={item.status === "ready" ? "Ready" : item.status === "error" ? "Failed" : item.status === "queued" ? "Waiting" : item.progress >= 95 ? "Finishing…" : `Uploading ${item.progress}%`} tone={item.status === "error" ? "red" : item.status === "ready" ? "green" : "yellow"} />
                    </div>
                    {item.status === "uploading" || item.status === "queued" ? <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} className="mt-2 h-1 overflow-hidden rounded bg-neutral-800"><div className="h-full bg-neutral-200" style={{ width: `${item.progress}%` }} /></div> : null}
                    {item.error ? <div className="mt-1"><p role="alert" className="text-[10px] text-red-300">{item.error}</p><button type="button" onClick={() => queue.retry(item.id)} className="mt-1 text-xs text-white underline">Retry</button></div> : null}
                </div>
            </div>)}
        </div>
    </div>
}
