import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { statusToneClasses, type StatusTone } from "./status-styles"

export function Status({ label, tone = "grey", className = "" }: { label: string; tone?: StatusTone; className?: string }) {
    const classes = statusToneClasses[tone]
    return (
        <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={classes.mark} />
            {label}
        </span>
    )
}
