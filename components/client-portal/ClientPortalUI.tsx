import type { ReactNode } from "react"

const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2" /></>,
    files: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8m-8 4h5" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
    chat: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z" /><path d="M8 9h8M8 13h5" /></>,
}

export function PortalIcon({ name, className = "h-5 w-5" }: { name: keyof typeof paths; className?: string }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{paths[name]}</svg>
}

export const portalPrimaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--onboarding-primary,#1E3A5F)] disabled:cursor-wait disabled:opacity-50"

// Dashboard sections are task areas, rather than record detail pages or workspace panel tabs.
export function PortalSection({ id, title, description, icon, children }: { id: string; title: string; description: string; icon: keyof typeof paths; children: ReactNode }) {
    return <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-6 rounded-[1.25rem] border border-black/[0.08] bg-[var(--onboarding-surface,#FFFFFF)] p-5 shadow-[0_2px_8px_-4px_rgb(15_23_42_/_0.12)] sm:p-6">
        <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_7%,transparent)] text-[var(--onboarding-primary,#1E3A5F)]"><PortalIcon name={icon} className="h-5 w-5" /></span>
            <div className="min-w-0"><h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm leading-5 text-[var(--onboarding-muted,#475569)]">{description}</p></div>
        </div>
        {children}
    </section>
}
