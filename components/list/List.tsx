import Link from "@/components/workspace/WorkspaceLink"
import type { ReactNode } from "react"
import { serializeWorkspaceDetailPreview, type WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

export function List({ children, ariaLabel, surface = "dark", embedded = false, flush = false, className = "" }: { children: ReactNode; ariaLabel?: string; surface?: "dark" | "light"; embedded?: boolean; flush?: boolean; className?: string }) {
    return <section role="list" aria-label={ariaLabel} data-surface={surface} className={`group/list ${flush ? "" : "mt-5"} overflow-hidden ${embedded ? "border-y border-card-border" : "rounded-2xl border border-card-border shadow-card"} ${surface === "light" ? "border-black/10 bg-[var(--onboarding-surface,#FFFFFF)]" : "bg-[var(--color-surface-1)]"} ${className}`}>{children}</section>
}

export function ListItem({ children, className = "", detailPreview }: { children: ReactNode; className?: string; detailPreview?: WorkspaceDetailPreview }) {
    return <article
        role="listitem"
        data-workspace-detail-preview={detailPreview ? serializeWorkspaceDetailPreview(detailPreview) : undefined}
        className={`border-b border-card-border transition-colors last:border-0 hover:bg-[var(--color-surface-hover)] group-data-[surface=light]/list:border-black/10 group-data-[surface=light]/list:hover:bg-black/[0.02] [contain-intrinsic-size:auto_88px] [content-visibility:auto] ${className}`}
    >{children}</article>
}

export function ListPrimaryRow({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2 group-data-[surface=light]/list:border-black/5 group-data-[surface=light]/list:bg-black/[0.015] sm:px-4 sm:py-2.5 ${className}`}>{children}</div>
}

export function ListSecondaryRow({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`flex min-w-0 flex-nowrap items-center gap-3 overflow-hidden whitespace-nowrap px-3.5 py-2 text-sm sm:px-4 sm:py-2.5 ${className}`}>{children}</div>
}

export function ListTitle({ children, href, external = false, className = "" }: { children: ReactNode; href?: string | null; external?: boolean; className?: string }) {
    const classes = `min-w-0 truncate text-base font-medium text-neutral-100 group-data-[surface=light]/list:text-[var(--onboarding-text,#0F172A)] ${href ? "hover:text-white group-data-[surface=light]/list:hover:text-[var(--onboarding-text,#0F172A)] hover:underline hover:decoration-neutral-600 hover:underline-offset-4" : ""} ${className}`
    if (!href) return <p className={classes}>{children}</p>
    if (external) return <a href={href} title={typeof children === "string" ? children : undefined} target="_blank" rel="noreferrer" className={classes}>{children}</a>
    return <Link href={href} prefetch={false} className={classes}>{children}</Link>
}

export function ListTrailing({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <div className={`ml-auto flex shrink-0 items-center gap-2 sm:gap-3 ${className}`}>{children}</div>
}

/**
 * A record in a narrow shell companion column (the Today column). The whole record is one activation target with a
 * meta line, a title of at most two lines and one supporting line; `current` marks the record open in the work area.
 * Panel collections keep the two-band anatomy above. See docs/ui-standards.md, "Compact companion lists".
 */
export function ListCompactItem({ meta, title, supporting, current = false, onOpen }: { meta?: ReactNode; title: ReactNode; supporting?: ReactNode; current?: boolean; onOpen?: () => void }) {
    const content = <>
        {meta ? <span className="flex min-h-5 min-w-0 items-center gap-2 text-xs text-neutral-400">{meta}</span> : null}
        <span className={`line-clamp-2 break-words text-sm font-medium leading-5 ${current ? "text-white" : "text-neutral-100"}`}>{title}</span>
        {supporting ? <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-neutral-400">{supporting}</span> : null}
    </>
    const layout = "flex w-full min-w-0 flex-col items-stretch gap-1 px-3.5 py-2.5 text-left"
    return <article role="listitem" className="border-b border-card-border last:border-0">
        {onOpen ? <button type="button" onClick={onOpen} aria-current={current ? "page" : undefined}
            className={`${layout} outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-white/[0.06] focus-visible:shadow-[inset_0_0_0_1px_var(--color-border-strong)] ${current ? "bg-white/[0.06] shadow-[inset_2px_0_0_var(--color-text-primary)]" : ""}`}>{content}</button>
            : <div className={layout}>{content}</div>}
    </article>
}
