"use client"

import { useLayoutEffect, useRef } from "react"
import { AnchoredPopup, Assignee } from "@/components/ui"
import { List, ListItem } from "@/components/list/List"
import type { MentionPerson } from "@/lib/chat-formatting"

export function ComposerMentionPicker({ anchor, people, active, onSelect, onDismiss }: {
    anchor: HTMLElement | null
    people: MentionPerson[]
    active: number
    onSelect: (person: MentionPerson) => void
    onDismiss: () => void
}) {
    const options = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const button = options.current?.querySelector<HTMLButtonElement>(`[data-mention-index="${active}"]`)
        // Scroll only the menu; scrollIntoView could move the composer or shell.
        const scroller = options.current
        if (!button || !scroller) return
        const row = button.getBoundingClientRect(), frame = scroller.getBoundingClientRect()
        if (row.top < frame.top) scroller.scrollTop -= frame.top - row.top
        else if (row.bottom > frame.bottom) scroller.scrollTop += row.bottom - frame.bottom
    }, [active, people])
    return <AnchoredPopup anchor={anchor} onDismiss={onDismiss} className="w-72 rounded-2xl border border-neutral-800 bg-black shadow-2xl">
        <div ref={options} data-composer-scroll className="overflow-y-auto overscroll-contain touch-pan-y" style={{ maxHeight: "min(16rem, 40dvh)" }}>
            <List ariaLabel="Mention a group member" embedded className="!mt-0 !border-0">
                {people.map((person, index) => <ListItem key={person.id} className="![content-visibility:visible]">
                    <button type="button" data-mention-index={index} aria-label={`Mention ${person.name}`} aria-current={index === active || undefined}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => onSelect(person)}
                        className={`flex min-h-11 w-full items-center px-3 py-2 text-left ${index === active ? "bg-neutral-900" : ""}`}>
                        <Assignee name={person.name} avatarSrc={person.avatarSrc} />
                    </button>
                </ListItem>)}
            </List>
            {!people.length ? <p className="px-3 py-3 text-xs text-neutral-500">No matching group members</p> : null}
        </div>
    </AnchoredPopup>
}
