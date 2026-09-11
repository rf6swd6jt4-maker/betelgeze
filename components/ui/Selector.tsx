"use client"

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { AnchoredPopup } from "./AnchoredPopup"

export type SelectorAppearance = "field" | "input" | "compact"

export type SelectorOptionDefinition = {
    value: string
    label: string
    content?: ReactNode
    description?: string
    disabled?: boolean
    searchText?: string
}

const triggerClasses: Record<SelectorAppearance, string> = {
    field: "-mx-1.5 min-h-8 w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 hover:bg-neutral-900/70",
    input: "h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 hover:border-neutral-500",
    compact: "min-h-8 max-w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 hover:border-neutral-600",
}

function SelectorChevron({ open }: { open: boolean }) {
    return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}><path d="m4 6 4 4 4-4" /></svg>
}

export const SelectorTrigger = forwardRef<HTMLButtonElement, {
    open: boolean
    appearance?: SelectorAppearance
    children: ReactNode
    className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">>(function SelectorTrigger({ open, appearance = "field", children, className = "", ...props }, ref) {
    return <button {...props} ref={ref} type="button" aria-expanded={open} aria-haspopup="listbox" className={`flex min-w-0 items-center gap-2 text-left text-sm text-neutral-200 outline-none transition focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-45 ${triggerClasses[appearance]} ${className}`}>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <SelectorChevron open={open} />
    </button>
})

export function SelectorDrawer({ anchor, ariaLabel, title, description, search, onSearch, searchPlaceholder = "Search…", children, empty, footer, onDismiss, className = "", workItemPopup = false, autoFocusOptions = true }: {
    anchor: HTMLElement | null
    ariaLabel: string
    title?: string
    description?: string
    search?: string
    onSearch?: (value: string) => void
    searchPlaceholder?: string
    children: ReactNode
    empty?: ReactNode
    footer?: ReactNode
    onDismiss: () => void
    className?: string
    workItemPopup?: boolean
    autoFocusOptions?: boolean
}) {
    const optionsRef = useRef<HTMLDivElement>(null)
    const focusOption = useCallback((position: "selected" | "first" | "last") => {
        const choices = [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
        const target = position === "last" ? choices.at(-1) : position === "selected" ? choices.find((choice) => choice.getAttribute("aria-selected") === "true") ?? choices[0] : choices[0]
        target?.focus({ preventScroll: true })
    }, [])
    useEffect(() => {
        if (onSearch || !autoFocusOptions) return
        const frame = window.requestAnimationFrame(() => focusOption("selected"))
        return () => window.cancelAnimationFrame(frame)
    }, [autoFocusOptions, focusOption, onSearch])

    function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        const choices = [...(optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])]
        if (!choices.length) return
        event.preventDefault()
        if (event.key === "Home") { choices[0].focus(); return }
        if (event.key === "End") { choices.at(-1)?.focus(); return }
        const current = choices.indexOf(optionsRef.current?.ownerDocument.activeElement as HTMLButtonElement)
        const offset = event.key === "ArrowDown" ? 1 : -1
        choices[(current < 0 ? offset > 0 ? 0 : choices.length - 1 : (current + offset + choices.length) % choices.length)]?.focus()
    }

    return <AnchoredPopup anchor={anchor} onDismiss={onDismiss} workItemPopup={workItemPopup} className={`w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60 ${className}`}>
        {title || description ? <header className="border-b border-neutral-800 px-3 py-2.5">
            {title ? <p className="text-xs font-medium text-neutral-200">{title}</p> : null}
            {description ? <p className={`${title ? "mt-0.5" : ""} text-[11px] leading-4 text-neutral-500`}>{description}</p> : null}
        </header> : null}
        {onSearch ? <input autoFocus aria-label={`Search ${ariaLabel.toLowerCase()}`} value={search ?? ""} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); focusOption("selected") } else if (event.key === "ArrowUp") { event.preventDefault(); focusOption("last") } }} placeholder={searchPlaceholder} className="h-9 w-full border-b border-neutral-800 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-neutral-600" /> : null}
        <div ref={optionsRef} role="listbox" aria-label={ariaLabel} onKeyDown={moveFocus} className="max-h-[min(16rem,45dvh)] overflow-y-auto overscroll-contain p-1">
            {children}
            {empty}
        </div>
        {footer ? <footer className="border-t border-neutral-800 p-1.5">{footer}</footer> : null}
    </AnchoredPopup>
}

export function SelectorOption({ selected = false, active = false, showCheck = true, children, description, action, className = "", ...props }: {
    selected?: boolean
    active?: boolean
    showCheck?: boolean
    children: ReactNode
    description?: string
    action?: ReactNode
    className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
    return <div className={`flex min-w-0 items-center rounded-lg ${selected || active ? "bg-neutral-900" : "hover:bg-neutral-900/70"} ${className}`}>
        <button {...props} type="button" role="option" aria-selected={selected} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-35">
            <span className="min-w-0 flex-1">
                <span className="block min-w-0 truncate">{children}</span>
                {description ? <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{description}</span> : null}
            </span>
            {showCheck ? <span aria-hidden="true" className={`w-4 shrink-0 text-center text-sm ${selected ? "text-white" : "text-transparent"}`}>✓</span> : null}
        </button>
        {action ? <div className="shrink-0 pr-1">{action}</div> : null}
    </div>
}

export function Selector({ value, options, onChange, onCommit, ariaLabel, placeholder = "Choose…", name, required = false, disabled = false, appearance = "field", className = "", popupClassName = "", title, description, searchThreshold = 7, searchPlaceholder = "Search…", workItemPopup = false }: {
    value: string
    options: SelectorOptionDefinition[]
    onChange: (value: string) => void
    onCommit?: (value: string) => void
    ariaLabel: string
    placeholder?: string
    name?: string
    required?: boolean
    disabled?: boolean
    appearance?: SelectorAppearance
    className?: string
    popupClassName?: string
    title?: string
    description?: string
    searchThreshold?: number
    searchPlaceholder?: string
    workItemPopup?: boolean
}) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const open = Boolean(anchor)
    const [query, setQuery] = useState("")
    const selected = options.find((option) => option.value === value)
    const searchable = options.length >= searchThreshold
    const visible = useMemo(() => {
        const normalized = query.trim().toLowerCase()
        if (!normalized) return options
        return options.filter((option) => (option.searchText ?? `${option.label} ${option.description ?? ""}`).toLowerCase().includes(normalized))
    }, [options, query])

    function choose(next: string) {
        onChange(next)
        setAnchor(null)
        setQuery("")
        onCommit?.(next)
    }

    return <>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        <SelectorTrigger open={open} appearance={appearance} disabled={disabled} aria-label={ariaLabel} aria-required={required || undefined} onClick={(event) => { setQuery(""); setAnchor((current) => current ? null : event.currentTarget) }} className={className}>
            {selected?.content ?? selected?.label ?? <span className="text-neutral-600">{placeholder}</span>}
        </SelectorTrigger>
        {open ? <SelectorDrawer anchor={anchor} ariaLabel={ariaLabel} title={title} description={description} search={query} onSearch={searchable ? setQuery : undefined} searchPlaceholder={searchPlaceholder} onDismiss={() => { setAnchor(null); setQuery("") }} className={popupClassName} workItemPopup={workItemPopup}>
            {visible.map((option) => <SelectorOption key={option.value || "__empty"} selected={option.value === value} disabled={option.disabled} description={option.description} onClick={() => choose(option.value)}>{option.content ?? option.label}</SelectorOption>)}
            {!visible.length ? <p className="px-2.5 py-3 text-xs text-neutral-500">No matching choices.</p> : null}
        </SelectorDrawer> : null}
    </>
}
