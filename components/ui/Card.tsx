import type { ReactNode } from "react"
import { cx } from "./cx"

export type CardPadding = "none" | "sm" | "md" | "lg"

const paddingClasses: Record<CardPadding, string> = {
    none: "",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
}

/**
 * The shared "box inside a page" container. Deliberately has no header/title
 * slot — compose a heading above the children and use the documented mt-2
 * title-to-description / mt-5 panel rhythm (docs/ui-standards.md) so that
 * rule stays in one place rather than duplicated into this component's API.
 */
export function Card({ children, padding = "sm", className = "" }: { children: ReactNode; padding?: CardPadding; className?: string }) {
    return <div className={cx("rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)]", paddingClasses[padding], className)}>{children}</div>
}
