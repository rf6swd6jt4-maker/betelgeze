import { portalProgressStatuses, portalProgressStepState, progressLabels, type PortalProgressStatus } from "@/lib/client-portal/overview"

function CheckIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-[3.25]"><path d="m5 12 4 4L19 6" /></svg>
}

export function ClientPortalProgressTimeline({ status, surface = "light" }: { status: PortalProgressStatus; surface?: "light" | "dark" }) {
    const dark = surface === "dark"
    return <ol aria-label={`Fulfilment progress: ${progressLabels[status]}`} className="grid gap-0 sm:grid-cols-5">
        {portalProgressStatuses.map((step, index) => {
            const state = portalProgressStepState(status, step)
            const complete = state === "complete"
            const current = state === "current"
            const nodeTone = complete
                ? dark ? "border-white bg-white text-black" : "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                : current
                    ? dark ? "border-white bg-black text-white" : "border-[var(--onboarding-primary,#1E3A5F)] bg-white text-[var(--onboarding-primary,#1E3A5F)]"
                    : dark ? "border-neutral-700 bg-neutral-950 text-neutral-500" : "border-black/15 bg-white text-[var(--onboarding-muted,#475569)]"
            const lineTone = complete
                ? dark ? "bg-white" : "bg-[var(--onboarding-primary,#1E3A5F)]"
                : dark ? "bg-neutral-800" : "bg-black/10"
            const labelTone = complete || current
                ? dark ? "text-neutral-100" : "text-[var(--onboarding-text,#0F172A)]"
                : dark ? "text-neutral-500" : "text-[var(--onboarding-muted,#475569)]"
            return <li key={step} aria-current={current ? "step" : undefined} className="relative flex min-h-12 items-center gap-3 pb-2 pl-1 sm:min-h-0 sm:flex-col sm:gap-0 sm:px-1 sm:pb-0">
                {index < portalProgressStatuses.length - 1 ? <span aria-hidden="true" className={`absolute bottom-0 left-[1.18rem] top-9 w-px sm:bottom-auto sm:left-1/2 sm:right-[-50%] sm:top-[0.9375rem] sm:h-px sm:w-auto ${lineTone}`} /> : null}
                <span aria-hidden="true" className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${nodeTone}`}>
                    {complete ? <CheckIcon /> : index + 1}
                </span>
                <span className={`min-w-0 text-sm font-medium sm:mt-2 sm:w-full sm:text-center sm:text-[11px] sm:leading-4 ${labelTone}`}>{progressLabels[step]}</span>
            </li>
        })}
    </ol>
}
