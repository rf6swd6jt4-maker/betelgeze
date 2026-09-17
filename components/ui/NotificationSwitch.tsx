"use client"

export function NotificationSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange?: () => void }) {
    return <button data-icon-button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-lg p-0 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40">
        <span aria-hidden="true" className={`relative block h-7 w-12 shrink-0 rounded-full border transition-colors ${checked ? "border-white bg-white" : "border-neutral-600 bg-neutral-800"}`}><span className={`absolute left-[3px] top-1/2 -translate-y-1/2 h-5 w-5 rounded-full transition-transform ${checked ? "translate-x-5 bg-black" : "translate-x-0 bg-neutral-400"}`} /></span>
    </button>
}
