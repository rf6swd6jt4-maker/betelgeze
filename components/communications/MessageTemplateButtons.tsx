import { safeTemplateButtonUrl, templateButtonDestinationLabel, templateEvidenceState, type CommunicationTemplateEvidence } from "@/lib/communications/template-evidence"
import type { CommunicationMessage } from "@/lib/communications/types"

/** Message content only: no requests, prefetch, receipt or read-state ownership. */
export function MessageTemplateButtons({ evidence, message }: {
    evidence: CommunicationTemplateEvidence
    message: Pick<CommunicationMessage, "status" | "providerMessageId" | "deliveredAt" | "readAt">
}) {
    return <div className="mt-3 min-w-0 border-t border-current/15 pt-2" data-template-buttons>
        {evidence.buttons.map((button) => {
            const url = safeTemplateButtonUrl(button.url)
            if (!url) return null
            return <a key={button.index} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
                className="flex min-h-11 min-w-0 flex-col justify-center rounded-md px-1 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
                <span className="text-sm font-semibold underline decoration-current/30 underline-offset-2">{button.label} <span aria-hidden="true">↗</span></span>
                <span className="max-w-full truncate text-[11px] opacity-65">{templateButtonDestinationLabel(url)}</span>
            </a>
        })}
        <p className="mt-1 text-[10px] opacity-60" title={`Retained template: ${evidence.templateName} (${evidence.language}). Delivery receipts describe the message; button display and clicks are not tracked.`}>{templateEvidenceState(message)} · button retained</p>
    </div>
}
