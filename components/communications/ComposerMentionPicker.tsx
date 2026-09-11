"use client"

import { useLayoutEffect, useRef } from "react"
import { Assignee, SelectorDrawer, SelectorOption } from "@/components/ui"
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
    return <SelectorDrawer anchor={anchor} onDismiss={onDismiss} ariaLabel="Mention a group member" autoFocusOptions={false} className="w-72">
        <div ref={options} data-composer-scroll className="max-h-[min(16rem,40dvh)] touch-pan-y overflow-y-auto overscroll-contain">
            {people.map((person, index) => <SelectorOption key={person.id} data-mention-index={index} aria-label={`Mention ${person.name}`} aria-current={index === active || undefined} active={index === active} showCheck={false}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onSelect(person)}>
                <Assignee name={person.name} avatarSrc={person.avatarSrc} />
            </SelectorOption>)}
            {!people.length ? <p className="px-3 py-3 text-xs text-neutral-500">No matching group members</p> : null}
        </div>
    </SelectorDrawer>
}
