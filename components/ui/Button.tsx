"use client"

import Link from "@/components/workspace/WorkspaceLink"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { cx } from "./cx"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive"
export type ButtonSize = "sm" | "md"

const variantClasses: Record<ButtonVariant, string> = {
    primary: "bg-white text-black hover:bg-neutral-200",
    secondary: "border border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
    ghost: "bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
    destructive: "border border-red-900/60 bg-red-950/40 text-red-200 hover:bg-red-950/60",
}

// md matches Selector's existing "input" surface height (40px); the mobile
// min-h-11 floor applies regardless of render target (button or anchor) so
// it holds even outside `main nav`, which is the only selector the global
// 44px mobile rule in globals.css covers for anchors.
const sizeClasses: Record<ButtonSize, string> = {
    sm: "min-h-11 gap-1.5 px-3 text-sm sm:min-h-9",
    md: "min-h-11 gap-2 px-4 text-sm sm:min-h-10",
}

type CommonProps = {
    variant?: ButtonVariant
    size?: ButtonSize
    children: ReactNode
    className?: string
}

type ButtonAsButton = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & { href?: undefined }
type ButtonAsLink = CommonProps & { href: string; external?: boolean; type?: undefined }

export function Button({ variant = "primary", size = "md", children, className = "", ...props }: ButtonAsButton | ButtonAsLink) {
    const classes = cx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium outline-none transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        className,
    )

    if ("href" in props && props.href) {
        const { href, external, ...rest } = props
        if (external) return <a href={href} target="_blank" rel="noreferrer" className={classes} {...rest}>{children}</a>
        return <Link href={href} className={classes} {...rest}>{children}</Link>
    }

    const { type = "button", ...rest } = props as ButtonAsButton
    return <button type={type} className={classes} {...rest}>{children}</button>
}
