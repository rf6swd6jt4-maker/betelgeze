"use client"

import { CommunicationMethodLabel, communicationMethodLabel, type CommunicationMethod } from "./CommunicationMethod"
import { Selector, type SelectorAppearance } from "./Selector"

type MethodChoice = {
    value: CommunicationMethod
    label?: string
    description?: string
    disabled?: boolean
}

export function CommunicationMethodSelector({ value, choices, onChange, onCommit, ariaLabel = "Communication method", placeholder = "Choose method", name, required = false, disabled = false, appearance = "field", className = "", title = "Communication method" }: {
    value: CommunicationMethod | ""
    choices: MethodChoice[]
    onChange: (value: CommunicationMethod | "") => void
    onCommit?: (value: CommunicationMethod | "") => void
    ariaLabel?: string
    placeholder?: string
    name?: string
    required?: boolean
    disabled?: boolean
    appearance?: SelectorAppearance
    className?: string
    title?: string
}) {
    return <Selector value={value} options={choices.map((choice) => ({
        value: choice.value,
        label: choice.label ?? communicationMethodLabel(choice.value),
        content: <CommunicationMethodLabel method={choice.value} label={choice.label} />,
        description: choice.description,
        disabled: choice.disabled,
    }))} onChange={(next) => onChange(next as CommunicationMethod)} onCommit={(next) => onCommit?.(next as CommunicationMethod)} ariaLabel={ariaLabel} placeholder={placeholder} name={name} required={required} disabled={disabled} appearance={appearance} className={className} title={title} searchThreshold={Number.POSITIVE_INFINITY} />
}
