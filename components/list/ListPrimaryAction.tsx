import type { ButtonHTMLAttributes } from "react"

const actionClass = "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-neutral-100 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] group-data-[surface=light]/list:text-[var(--onboarding-primary,#1E3A5F)] group-data-[surface=light]/list:hover:bg-black/5"

function ActionIcon({ download }: { download?: boolean }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">{download ? <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /> : <path d="m9 5 7 7-7 7" />}</svg>
}

/** An explicit primary action for simple client-facing lists, visible at every width. */
export function ListPrimaryAction({ label, accessibleLabel, href, download = false, onClick }: { label: string; accessibleLabel: string; href?: string; download?: boolean; onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"] }) {
    const children = <>{download ? <ActionIcon download /> : null}<span>{label}</span>{!download ? <ActionIcon /> : null}</>
    return href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={accessibleLabel} className={actionClass}>{children}</a> : <button type="button" onClick={onClick} aria-label={accessibleLabel} className={actionClass}>{children}</button>
}
