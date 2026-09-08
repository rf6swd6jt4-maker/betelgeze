"use client"
import { useState } from "react"
import { Assignee } from "@/components/ui"
import { List, ListItem } from "@/components/list/List"

export function DeliveryUserPicker({ people, selected, onChange, disabled = false }: {
    people: Array<{ id: string; name: string; avatarSrc?: string | null }>
    selected: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
}) {
    const [search, setSearch] = useState("")
    const visible = people.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    return <div>
        {people.length > 6 ? <input aria-label="Find a person" placeholder="Find a person…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm" /> : null}
        <List ariaLabel="Eligible fulfilment people" className="!mt-2 max-h-52 overflow-y-auto !rounded-lg">
            {visible.map((person) => <ListItem key={person.id} className="!bg-transparent">
                <label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2">
                    <input type="checkbox" disabled={disabled} checked={selected.includes(person.id)} onChange={(e) => onChange(e.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} className="h-4 w-4 shrink-0 accent-white" />
                    <Assignee name={person.name} avatarSrc={person.avatarSrc} />
                </label>
            </ListItem>)}
            {!visible.length ? <p className="px-3 py-3 text-sm text-neutral-500">No matching people.</p> : null}
        </List>
    </div>
}
