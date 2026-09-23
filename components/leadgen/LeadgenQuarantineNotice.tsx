import { LEADGEN_PAUSED_MESSAGE, leadgenOperationsAvailable } from "@/lib/leadgen/availability"

export function LeadgenQuarantineNotice() {
    if (leadgenOperationsAvailable()) return null
    return <p role="status" className="my-4 text-sm leading-6 text-neutral-400">{LEADGEN_PAUSED_MESSAGE}</p>
}
