import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
export type StatusTone = "grey" | "yellow" | "green" | "red"

const toneClasses: Record<StatusTone, { mark: string; text: string }> = {
    grey: { mark: "bg-neutral-400", text: "text-neutral-300" },
    yellow: { mark: "bg-yellow-300", text: "text-yellow-200" },
    green: { mark: "bg-emerald-300", text: "text-emerald-200" },
    red: { mark: "bg-red-300", text: "text-red-200" },
}

export function Status({ label, tone = "grey", className = "" }: { label: string; tone?: StatusTone; className?: string }) {
    const classes = toneClasses[tone]
    return (
        <span className={`inline-flex items-center gap-2 whitespace-nowrap text-sm ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={classes.mark} />
            {label}
        </span>
    )
}
