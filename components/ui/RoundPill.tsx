import type { ReactNode } from "react"
import { pillToneClasses, type PillTone } from "./pill-styles"

export function RoundPill({ children, tone = "neutral", leading, className = "" }: { children: ReactNode; tone?: PillTone; leading?: ReactNode; className?: string }) {
    return <span className={`inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-4 ${pillToneClasses[tone]} ${className}`}>{leading}<span className="truncate">{children}</span></span>
}
