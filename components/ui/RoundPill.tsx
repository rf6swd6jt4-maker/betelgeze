import type { ReactNode } from "react"
import { pillTones, type PillTone } from "./pill-styles"

export function RoundPill({ children, tone = "neutral", leading, className = "" }: { children: ReactNode; tone?: PillTone; leading?: ReactNode; className?: string }) {
    const colours = pillTones[tone]
    return <span style={{ borderColor: colours.border, backgroundColor: colours.background, color: colours.text }} className={`inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-4 ${className}`}>{leading}<span className="truncate">{children}</span></span>
}
