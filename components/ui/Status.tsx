import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { lightStatusToneClasses, statusToneClasses, type StatusTone } from "./status-styles"

export function Status({ label, tone = "grey", surface = "dark", compact = false, wrap = false, className = "" }: { label: string; tone?: StatusTone; surface?: "dark" | "light"; compact?: boolean; wrap?: boolean; className?: string }) {
    const classes = (surface === "light" ? lightStatusToneClasses : statusToneClasses)[tone]
    return (
        <span aria-label={compact ? label : undefined} title={compact ? label : undefined} className={`inline-flex ${wrap ? "min-w-0 items-start whitespace-normal" : "items-center whitespace-nowrap"} ${compact ? "gap-0" : "gap-2 text-sm"} ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={`${classes.mark} ${wrap ? "mt-1 shrink-0" : ""}`} />
            {compact ? null : <span className={wrap ? "min-w-0 break-words" : undefined}>{label}</span>}
        </span>
    )
}
