import type { ReactNode } from "react"

export type PillTone = "neutral" | "info" | "success" | "warning" | "danger"

const toneClasses: Record<PillTone, string> = {
    neutral: "border-neutral-700 bg-neutral-900 text-neutral-300",
    info: "border-sky-400/20 bg-sky-400/10 text-sky-200",
    success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    danger: "border-red-400/20 bg-red-400/10 text-red-200",
}

export function Pill({
    children,
    tone = "neutral",
    leading,
    className = "",
}: {
    children: ReactNode
    tone?: PillTone
    leading?: ReactNode
    className?: string
}) {
    return (
        <span className={`inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 ${toneClasses[tone]} ${className}`}>
            {leading}
            <span className="truncate">{children}</span>
        </span>
    )
}
