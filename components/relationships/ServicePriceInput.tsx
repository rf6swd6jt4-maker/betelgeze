"use client"
import { useState } from "react"
const inputClass = "min-h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-base text-white sm:text-sm"
export function MoneyField({
    label,
    value,
    onChange,
    disabled,
}: {
    label: string
    value: number
    onChange: (cents: number) => void
    disabled: boolean
}) {
    const [editing, setEditing] = useState<{ text: string; cents: number } | null>(null)
    return (
        <label className="block min-w-0 text-xs text-neutral-400">
            {label.split(" for ")[0]}
            <input
                aria-label={label}
                className={`${inputClass} mt-1`}
                type="text"
                inputMode="decimal"
                maxLength={14}
                value={editing?.cents === value ? editing.text : (value / 100).toFixed(2)}
                placeholder="0.00"
                disabled={disabled}
                onChange={(event) => {
                    const text = event.target.value
                    if (!/^\d*(?:\.\d{0,2})?$/.test(text)) return
                    const cents = Math.round(Number(text === "." ? "0" : text) * 100)
                    if (!Number.isSafeInteger(cents) || cents > 99999999) return
                    setEditing({ text, cents })
                    onChange(cents)
                }}
                onBlur={() => setEditing(null)}
                onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }}
            />
        </label>
    )
}
