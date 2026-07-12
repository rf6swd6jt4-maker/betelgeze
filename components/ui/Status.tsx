import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { statusToneClasses, type StatusTone } from "./status-styles"

export function Status({ label, tone = "grey", compact = false, className = "" }: { label: string; tone?: StatusTone; compact?: boolean; className?: string }) {
    const classes = statusToneClasses[tone]
    return (
        <span aria-label={compact ? label : undefined} title={compact ? label : undefined} className={`inline-flex items-center whitespace-nowrap ${compact ? "gap-0" : "gap-2 text-sm"} ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={classes.mark} />
            {compact ? null : label}
        </span>
    )
}
