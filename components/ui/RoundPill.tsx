import type { ReactNode } from "react"
import { pillClass, pillTones, type PillTone } from "./pill-styles"

export function RoundPill({ children, tone = "neutral", leading, className = "" }: { children: ReactNode; tone?: PillTone; leading?: ReactNode; className?: string }) {
    const colours = pillTones[tone]
    return <span style={{ backgroundColor: colours.background, color: colours.text }} className={`${pillClass} ${className}`}>{leading}<span className="truncate">{children}</span></span>
}
