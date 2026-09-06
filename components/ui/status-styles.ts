export type StatusTone = "grey" | "yellow" | "green" | "red"

export const statusToneClasses: Record<StatusTone, { mark: string; text: string }> = {
    grey: { mark: "bg-neutral-400", text: "text-neutral-300" },
    yellow: { mark: "bg-yellow-300", text: "text-yellow-200" },
    green: { mark: "bg-emerald-300", text: "text-emerald-200" },
    red: { mark: "bg-red-300", text: "text-red-200" },
}

export const lightStatusToneClasses: Record<StatusTone, { mark: string; text: string }> = {
    grey: { mark: "bg-neutral-500", text: "text-neutral-600" },
    yellow: { mark: "bg-yellow-600", text: "text-yellow-800" },
    green: { mark: "bg-emerald-600", text: "text-emerald-800" },
    red: { mark: "bg-red-600", text: "text-red-800" },
}
