"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import { QuickStats, type QuickStat } from "@/components/panel/QuickStats"

export type ClientPortalReportMetric = {
    label: string
    value: ReactNode
}

const subscribeToHydration = () => () => undefined

function formattedUpdate(value: string) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function ClientPortalReport({
    title,
    periodLabel,
    updatedAt,
    accountName,
    stats,
    metrics,
    controls,
    emptyMessage,
    note,
    children,
}: {
    title: string
    periodLabel: string
    updatedAt?: string | null
    accountName?: string | null
    stats: QuickStat[]
    metrics: ClientPortalReportMetric[]
    controls?: ReactNode
    emptyMessage?: string | null
    note?: ReactNode
    children?: ReactNode
}) {
    const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false)
    const updated = hydrated && updatedAt ? formattedUpdate(updatedAt) : null
    return <section aria-label={title} className="mt-5 min-w-0 border-t border-black/10 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--onboarding-text,#0F172A)]">{title}</h3>
                <p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">{periodLabel}{updated ? <> <span aria-hidden="true">·</span> Updated {updated}</> : null}</p>
            </div>
            {controls ? <div className="shrink-0">{controls}</div> : accountName ? <p className="max-w-full truncate text-sm font-medium text-[var(--onboarding-text,#0F172A)]" title={accountName}>{accountName}</p> : null}
        </div>
        {controls && accountName ? <p className="mt-3 truncate text-sm font-medium text-[var(--onboarding-text,#0F172A)]" title={accountName}>{accountName}</p> : null}
        {stats.length ? <QuickStats surface="light" ariaLabel={`${title} summary`} items={stats} /> : null}
        {metrics.length ? <dl className={`mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 ${metrics.length > 4 ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4"}`}>
            {metrics.map((metric) => <div key={metric.label} className="min-w-0 bg-[var(--onboarding-surface,#FFFFFF)] px-3 py-3">
                <dt className="truncate text-xs text-[var(--onboarding-muted,#475569)]">{metric.label}</dt>
                <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-[var(--onboarding-text,#0F172A)]" title={typeof metric.value === "string" ? metric.value : undefined}>{metric.value}</dd>
            </div>)}
        </dl> : null}
        {emptyMessage ? <p role="status" className="mt-4 rounded-xl bg-black/[0.035] px-3 py-2.5 text-sm text-[var(--onboarding-muted,#475569)]">{emptyMessage}</p> : null}
        {children}
        {note ? <div className="mt-4 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">{note}</div> : null}
    </section>
}
