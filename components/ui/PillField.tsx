"use client"
import type { ReactNode } from "react"

/** A multi-value field: assigned pills followed by one anchored add control. */
export function PillField({ children, empty = "None", addLabel, onAdd, disabled = false, open = false }: { children?: ReactNode; empty?: string; addLabel?: string; onAdd?: (anchor: HTMLButtonElement) => void; disabled?: boolean; open?: boolean }) {
    return <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children || <span className="text-neutral-600">{empty}</span>}{onAdd ? <button type="button" data-icon-button aria-label={addLabel ?? "Add"} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={event => onAdd(event.currentTarget)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400 disabled:opacity-40"><span aria-hidden="true" className="text-xl leading-none">+</span></button> : null}</div>
}
