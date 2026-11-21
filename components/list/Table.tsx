"use client"

import type { MouseEvent, ReactNode } from "react"

/**
 * A table for a collection whose records are compared down the same columns (Clients). One line per record, hairline
 * rows on the canvas, grey column labels, and nothing boxed. `List` remains the form for records with their own mix of
 * supporting facts. See docs/ui-standards.md, "Table".
 *
 * The record's name is a real link marked `data-table-open`; pressing anywhere else on the row follows that same
 * link, so there is one destination and one way to reach it.
 */
export function Table({ ariaLabel, children, className = "" }: { ariaLabel: string; children: ReactNode; className?: string }) {
    return <div className={`-mx-2 mt-4 overflow-x-auto ${className}`}>
        <table aria-label={ariaLabel} className="w-full border-collapse text-[13px]">{children}</table>
    </div>
}

export function TableHead({ children }: { children: ReactNode }) {
    return <thead><tr>{children}</tr></thead>
}

export function TableHeading({ children, numeric = false, className = "" }: { children: ReactNode; numeric?: boolean; className?: string }) {
    return <th scope="col" className={`h-8 whitespace-nowrap border-b border-card-border px-2 text-xs font-normal text-neutral-500 ${numeric ? "text-right" : "text-left"} ${className}`}>{children}</th>
}

export function TableBody({ children }: { children: ReactNode }) {
    return <tbody>{children}</tbody>
}

function followRowLink(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if ((event.target as Element).closest("a, button, input, select, textarea, label, [role='button']")) return
    if (window.getSelection()?.toString()) return
    event.currentTarget.querySelector<HTMLAnchorElement>("a[data-table-open]")?.click()
}

export function TableRow({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <tr onClick={followRowLink} className={`cursor-pointer border-b border-card-border transition-colors hover:bg-[var(--color-surface-hover)] ${className}`}>{children}</tr>
}

export function TableCell({ children, primary = false, numeric = false, className = "" }: { children: ReactNode; primary?: boolean; numeric?: boolean; className?: string }) {
    return <td className={`h-10 whitespace-nowrap px-2 ${primary ? "font-medium text-neutral-100" : "text-neutral-400"} ${numeric ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
}

/** The empty state of a table: one quiet line where the rows would be. */
export function TableEmpty({ columns, children }: { columns: number; children: ReactNode }) {
    return <tr><td colSpan={columns} className="px-2 py-8 text-sm text-neutral-400">{children}</td></tr>
}
