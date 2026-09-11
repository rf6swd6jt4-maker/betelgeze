"use client"

import { Assignee } from "./Assignee"
import { Selector, type SelectorAppearance } from "./Selector"

export type AssignmentPerson = {
    id: string
    name: string
    avatarSrc?: string | null
    description?: string
}

export function AssignmentSelector({ value, people, onChange, onCommit, ariaLabel, placeholder = "Choose person", clearLabel, name, required = false, disabled = false, appearance = "field", className = "", title = "Assign person", description, workItemPopup = false }: {
    value: string
    people: AssignmentPerson[]
    onChange: (value: string) => void
    onCommit?: (value: string) => void
    ariaLabel: string
    placeholder?: string
    clearLabel?: string
    name?: string
    required?: boolean
    disabled?: boolean
    appearance?: SelectorAppearance
    className?: string
    title?: string
    description?: string
    workItemPopup?: boolean
}) {
    const options = [
        ...(clearLabel ? [{ value: "", label: clearLabel, content: <span className="text-neutral-500">{clearLabel}</span> }] : []),
        ...people.map((person) => ({
            value: person.id,
            label: person.name,
            description: person.description,
            searchText: `${person.name} ${person.description ?? ""}`,
            content: <Assignee name={person.name} avatarSrc={person.avatarSrc} />,
        })),
    ]
    return <Selector value={value} options={options} onChange={onChange} onCommit={onCommit} ariaLabel={ariaLabel} placeholder={placeholder} name={name} required={required} disabled={disabled} appearance={appearance} className={className} title={title} description={description} searchPlaceholder="Find a person…" workItemPopup={workItemPopup} />
}
