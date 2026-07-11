export type PillTone = "neutral" | "sky" | "emerald" | "yellow" | "amber" | "red" | "violet"

export type PillToneValues = { border: string; background: string; text: string }

export const pillTones: Record<PillTone, PillToneValues> = {
    neutral: { border: "#404040", background: "#171717", text: "#D4D4D4" },
    sky: { border: "#01426B", background: "#051B29", text: "#B6E4FC" },
    emerald: { border: "#014E38", background: "#051C16", text: "#A4F5CF" },
    yellow: { border: "#7A5A00", background: "#292005", text: "#FFF085" },
    amber: { border: "#6D2D00", background: "#281206", text: "#FEE685" },
    red: { border: "#720810", background: "#28090A", text: "#FFC9C9" },
    violet: { border: "#440D89", background: "#1D0C39", text: "#DDD6FF" },
}
