"use client"

/**
 * Two or three mutually exclusive views of the same companion surface (the client column's Context / Chat). Not a
 * panel tab strip and not a filter: it never navigates and never changes which records are shown elsewhere.
 * See docs/ui-standards.md, "SegmentedSwitch".
 */
export function SegmentedSwitch<Value extends string>({ label, value, options, onChange, className = "" }: {
    label: string; value: Value; options: ReadonlyArray<{ value: Value; label: string }>; onChange: (value: Value) => void; className?: string
}) {
    return <div role="group" aria-label={label} className={`flex rounded-lg border border-card-border bg-[var(--color-surface-canvas)] p-0.5 ${className}`}>
        {options.map(option => {
            const selected = option.value === value
            // data-icon-button: a 30px segment inside a 36px control, not an ordinary 44px mobile button.
            return <button key={option.value} type="button" data-icon-button aria-pressed={selected} onClick={() => { if (!selected) onChange(option.value) }}
                className={`min-h-[30px] flex-1 rounded-md px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 ${selected ? "bg-neutral-800 font-semibold text-neutral-100" : "text-neutral-400 hover:text-neutral-100"}`}>{option.label}</button>
        })}
    </div>
}
