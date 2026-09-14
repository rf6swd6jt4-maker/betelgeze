"use client"
import Link from "@/components/workspace/WorkspaceLink"
import { useState } from "react"
import { RoundPill } from "./RoundPill"
import { SelectorDrawer } from "./Selector"

export function CollapsedPillLinks({ items, label, limit = 3 }: { items: { id: string; label: string; href: string }[]; label: string; limit?: number }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    return <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {items.slice(0, limit).map(item => <Link key={item.id} href={item.href} prefetch={false} className="max-w-full"><RoundPill tone="sky">{item.label}</RoundPill></Link>)}
        {!items.length ? <span className="text-neutral-600">None</span> : null}
        {items.length > limit ? <button type="button" data-icon-button aria-label={`Show ${items.length - limit} more ${label}`} aria-expanded={Boolean(anchor)} aria-haspopup="listbox" onClick={event => setAnchor(event.currentTarget)} className="max-w-full rounded-full focus-visible:outline focus-visible:outline-2"><RoundPill>+{items.length - limit}</RoundPill></button> : null}
        <SelectorDrawer anchor={anchor} ariaLabel={label} title={label} onDismiss={() => setAnchor(null)}>{items.slice(limit).map(item => <Link key={item.id} href={item.href} prefetch={false} onClick={() => setAnchor(null)} className="block min-w-0 rounded-lg px-2 py-2 hover:bg-neutral-900"><RoundPill tone="sky">{item.label}</RoundPill></Link>)}</SelectorDrawer>
    </div>
}
