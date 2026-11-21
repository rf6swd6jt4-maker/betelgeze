export type StatusTone = "grey" | "yellow" | "green" | "red"

// Colour lives in the Betelgeze diamond (`mark`) and in a StatusStat's number (`accent`); the label beside it is plain
// text, so a screen of statuses stays calm. See docs/ui-standards.md, "Status".
export const statusToneClasses: Record<StatusTone, { mark: string; text: string; accent: string }> = {
    grey: { mark: "bg-neutral-500", text: "text-neutral-200", accent: "text-neutral-300" },
    yellow: { mark: "bg-yellow-300", text: "text-neutral-200", accent: "text-yellow-200" },
    green: { mark: "bg-emerald-300", text: "text-neutral-200", accent: "text-emerald-200" },
    red: { mark: "bg-red-400", text: "text-neutral-200", accent: "text-red-300" },
}

export const lightStatusToneClasses: Record<StatusTone, { mark: string; text: string; accent: string }> = {
    grey: { mark: "bg-neutral-500", text: "text-neutral-600", accent: "text-neutral-600" },
    yellow: { mark: "bg-yellow-600", text: "text-yellow-800", accent: "text-yellow-800" },
    green: { mark: "bg-emerald-600", text: "text-emerald-800", accent: "text-emerald-800" },
    red: { mark: "bg-red-600", text: "text-red-800", accent: "text-red-800" },
}
