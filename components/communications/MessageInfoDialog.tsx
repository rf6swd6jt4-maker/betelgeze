"use client"

import { lazy, Suspense } from "react"
import { CenteredDialog } from "@/components/ui/CenteredDialog"
import type { MessageInfoProps } from "./MessageInfoContent"

const MessageInfoContent = lazy(() => import("./MessageInfoContent"))

export function MessageInfoDialog({ onClose, ...props }: MessageInfoProps & { onClose: () => void }) {
    return <CenteredDialog title="Message info" short onClose={onClose}>
        <Suspense fallback={<p role="status" className="text-sm text-neutral-400">Loading message info…</p>}>
            <MessageInfoContent {...props} />
        </Suspense>
    </CenteredDialog>
}
