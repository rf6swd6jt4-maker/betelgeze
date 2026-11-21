import type { ReactNode } from "react"

export type DetailFieldIcon =
    | "status"
    | "schedule"
    | "user"
    | "person"
    | "identity"
    | "contact"
    | "company"
    | "role"
    | "location"
    | "parent"
    | "dependency"
    | "relationship"
    | "priority"
    | "services"
    | "modules"
    | "description"
    | "progress"
    | "file"
    | "size"
    | "source"
    | "time"
    | "activity"
    | "timeline"

function DetailFieldIconMark({ kind }: { kind: DetailFieldIcon }) {
    const paths: Record<DetailFieldIcon, ReactNode> = {
        status: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></>,
        schedule: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        person: <><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M3 20c.5-4 2.2-6 5-6M21 20c-.5-4-2.2-6-5-6" /></>,
        identity: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        contact: <><path d="M5 5h14v14H5z" /><path d="m6 7 6 5 6-5" /></>,
        company: <><path d="M4 21V5h10v16M14 9h6v12M7 9h4M7 13h4M7 17h4M17 13h1M17 17h1M2 21h20" /></>,
        role: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M9 6V4h6v2M3 11h18M10 14h4" /></>,
        location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
        parent: <><path d="M6 5h5v5H6zM13 14h5v5h-5zM8.5 10v2a4 4 0 0 0 4 4h.5" /></>,
        dependency: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M9.5 9.5l5 5" /></>,
        relationship: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20c.5-3.3 2.3-5 5.5-5M21.5 20c-.5-3.3-2.3-5-5.5-5M10 17h4" /></>,
        priority: <><path d="M6 21V4M6 5h11l-2 4 2 4H6" /></>,
        services: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="7" cy="7" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17" cy="17" r="1" /></>,
        modules: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
        description: <><path d="M5 5h14M5 9h14M5 13h10M5 17h12" /></>,
        progress: <><path d="M5 19V9M12 19V5M19 19v-7" /></>,
        file: <><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></>,
        size: <><path d="M5 19 19 5M9 5h10v10" /></>,
        source: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4M8 13l8 4" /></>,
        time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
        activity: <><path d="M4 12h4l2-6 4 12 2-6h4" /></>,
        timeline: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
    }
    return <svg aria-hidden="true" data-detail-field-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">{paths[kind]}</svg>
}

/** The label column of a narrow property list. Hand-built rows beside one (a row that is a button) use the same. */
export const narrowPropertyGrid = "grid-cols-[6rem_minmax(0,1fr)]"

/**
 * A narrow property list on a phone: 44px rows with a 16px value, the size an editable field must have there (smaller
 * type makes iOS zoom the page on focus), so read-only rows, rows that open something and fields keep one rhythm.
 */
export const touchPropertyRows = "max-sm:[&>div]:min-h-11 max-sm:[&>div]:items-center max-sm:[&>div]:py-0 max-sm:[&>div>div]:text-base"
/** The same sizing for one hand-built row, and for a `Status` or `Assignee` shown as a row's value. */
export const touchPropertyRow = "max-sm:min-h-11 max-sm:items-center max-sm:py-0"
export const touchPropertyValue = "max-sm:text-base"

/** `narrow` is the property list of a details column (the client page): one column, flush, with a 6rem label. */
export function DetailFields({ children, surface = "dark", columns = 2, narrow = false, className = "" }: { children: ReactNode; surface?: "dark" | "light"; columns?: 1 | 2; narrow?: boolean; className?: string }) {
    return <section data-surface={surface} className={`group/fields grid grid-cols-1 ${narrow ? "[&>div]:grid-cols-[6rem_minmax(0,1fr)] sm:[&>div]:grid-cols-[6rem_minmax(0,1fr)]" : `mt-5 ${columns === 2 ? "lg:grid-cols-2" : ""}`} ${className}`}>{children}</section>
}

export function DetailField({ label, icon, children, multiline = false, stackOnMobile = false, className = "" }: { label: string; icon: DetailFieldIcon; children: ReactNode; multiline?: boolean; stackOnMobile?: boolean; className?: string }) {
    // Workspace (dark): a plain property row, grey label then value, with no divider and no icon. Light client-facing
    // panels keep their divider and icon.
    return <div className={`grid min-h-9 ${stackOnMobile ? "grid-cols-1" : "grid-cols-[8rem_minmax(0,1fr)]"} ${multiline ? "items-start" : "items-baseline"} gap-2 py-1.5 group-data-[surface=light]/fields:min-h-10 group-data-[surface=light]/fields:border-b group-data-[surface=light]/fields:border-black/10 group-data-[surface=light]/fields:py-2 sm:grid-cols-[9rem_minmax(0,1fr)] ${className}`}>
        <p className={`flex items-center gap-2 text-sm text-neutral-500 ${multiline ? "pt-1.5" : ""}`}><span className="hidden group-data-[surface=light]/fields:inline-flex"><DetailFieldIconMark kind={icon} /></span><span>{label}</span></p>
        <div className="min-w-0 text-sm text-neutral-200 group-data-[surface=light]/fields:text-[var(--onboarding-text,#0F172A)]">{children}</div>
    </div>
}

/**
 * The heading of a section inside a record or client page: small and grey, so the content beneath it leads. An optional
 * count sits beside it and an optional action at the far end. Sections are separated by space, not boxes.
 */
export function SectionHeading({ children, count, action, className = "" }: { children: ReactNode; count?: ReactNode; action?: ReactNode; className?: string }) {
    return <div className={`flex min-h-7 items-center gap-2 ${className}`}>
        <h2 className="text-xs font-medium text-neutral-500">{children}</h2>
        {count !== undefined && count !== null ? <span className="text-xs tabular-nums text-neutral-600">{count}</span> : null}
        {action ? <span className="ml-auto flex items-center gap-2">{action}</span> : null}
    </div>
}
