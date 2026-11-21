export type PillTone = "neutral" | "sky" | "emerald" | "yellow" | "amber" | "red" | "violet"

/**
 * `background` and `text` colour a pill; `mark` colours a stage's Betelgeze diamond; `border` remains for timeline bars
 * (the relationship Gantt), which still outline their coloured fills. Pills themselves have no border.
 */
export type PillToneValues = { border: string; background: string; text: string; mark: string }

export const pillTones: Record<PillTone, PillToneValues> = {
    neutral: { border: "#404040", background: "#171717", text: "#D4D4D4", mark: "#8A8A8A" },
    sky: { border: "#01426B", background: "#051B29", text: "#B6E4FC", mark: "#7DD3FC" },
    emerald: { border: "#014E38", background: "#051C16", text: "#A4F5CF", mark: "#6EE7B7" },
    yellow: { border: "#8A7D00", background: "#2B2A08", text: "#FFF3A3", mark: "#FDE047" },
    amber: { border: "#6D2D00", background: "#281206", text: "#FEE685", mark: "#FDBA74" },
    red: { border: "#720810", background: "#28090A", text: "#FFC9C9", mark: "#F87171" },
    violet: { border: "#440D89", background: "#1D0C39", text: "#DDD6FF", mark: "#C4B5FD" },
}

/** One flat tag shape for every pill: a tinted face, no border, the workspace's 6px corner. */
export const pillClass = "inline-flex min-h-[22px] max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs leading-4"
