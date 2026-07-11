export type StatusTone = "grey" | "yellow" | "green" | "red"

export const statusToneClasses: Record<StatusTone, { mark: string; text: string }> = {
    grey: { mark: "bg-neutral-400", text: "text-neutral-300" },
    yellow: { mark: "bg-yellow-300", text: "text-yellow-200" },
    green: { mark: "bg-emerald-300", text: "text-emerald-200" },
    red: { mark: "bg-red-300", text: "text-red-200" },
}
