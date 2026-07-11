export type PillTone = "neutral" | "sky" | "emerald" | "amber" | "red" | "violet"

export const pillToneClasses: Record<PillTone, string> = {
    neutral: "border-neutral-700 bg-neutral-900 text-neutral-300",
    sky: "border-sky-800/70 bg-sky-950/50 text-sky-200",
    emerald: "border-emerald-800/70 bg-emerald-950/50 text-emerald-200",
    amber: "border-amber-800/70 bg-amber-950/50 text-amber-200",
    red: "border-red-800/70 bg-red-950/50 text-red-200",
    violet: "border-violet-800/70 bg-violet-950/50 text-violet-200",
}
