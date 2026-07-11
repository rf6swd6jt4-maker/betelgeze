import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import type { PillTone } from "./Pill"

const toneClasses: Record<PillTone, { mark: string; text: string }> = {
    neutral: { mark: "bg-neutral-500", text: "text-neutral-400" },
    info: { mark: "bg-sky-300", text: "text-sky-200" },
    success: { mark: "bg-emerald-300", text: "text-emerald-200" },
    warning: { mark: "bg-amber-300", text: "text-amber-200" },
    danger: { mark: "bg-red-300", text: "text-red-200" },
}

export function Status({ label, tone = "neutral", className = "" }: { label: string; tone?: PillTone; className?: string }) {
    const classes = toneClasses[tone]
    return (
        <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={classes.mark} />
            {label}
        </span>
    )
}
