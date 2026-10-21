"use client"
import { useState } from "react"
import { SelectorDrawer, SelectorOption, SelectorTrigger } from "@/components/ui"
import { calendarChoiceLabel } from "@/lib/client-portal/ghl-calendar"
type Choice = { id: string; name: string; isActive?: boolean }
export function GhlCalendarPicker({ calendars, value, onChange, disabled }: { calendars: Choice[]; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null), [search, setSearch] = useState("")
    const visible = calendars.filter(item => calendarChoiceLabel(item, calendars).toLowerCase().includes(search.toLowerCase().trim()))
    return <>
        <SelectorTrigger appearance="input" open={!!anchor} disabled={disabled} aria-label="HighLevel calendars" onClick={event => { setSearch(""); setAnchor(anchor ? null : event.currentTarget) }}>
            {value.length === 1 ? calendarChoiceLabel(calendars.find(item => item.id === value[0]) ?? { id: value[0], name: "Unavailable calendar" }, calendars) : value.length ? `${value.length} calendars selected` : "Choose calendars"}
        </SelectorTrigger>
        {anchor ? <SelectorDrawer anchor={anchor} ariaLabel="HighLevel calendars" multiselectable title="Client calendars" description="Choose up to ten. The portal displays one at a time; notifications cover all selected calendars." search={search} onSearch={calendars.length >= 7 ? setSearch : undefined} onDismiss={() => setAnchor(null)} footer={<button type="button" className="min-h-11 w-full text-sm text-white" onClick={() => setAnchor(null)}>Done choosing calendars</button>}>
            {visible.map(item => <SelectorOption key={item.id} selected={value.includes(item.id)} disabled={disabled || (!value.includes(item.id) && value.length >= 10)} onClick={() => onChange(value.includes(item.id) ? value.filter(id => id !== item.id) : [...value, item.id])}>{calendarChoiceLabel(item, calendars)}</SelectorOption>)}
            {!visible.length ? <p className="px-3 py-2 text-sm text-neutral-400">No matching calendars.</p> : null}
        </SelectorDrawer> : null}
    </>
}
