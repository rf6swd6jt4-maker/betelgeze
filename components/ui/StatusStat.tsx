import { statusToneClasses, type StatusTone } from "./status-styles"

export function StatusStat({ value, label, tone = "grey", className = "" }: { value: number | string; label: string; tone?: StatusTone; className?: string }) {
    const classes = statusToneClasses[tone]
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs leading-4 ${classes.text} ${className}`}>
            <span className="font-semibold tabular-nums">{value}</span>
            {label}
        </span>
    )
}
