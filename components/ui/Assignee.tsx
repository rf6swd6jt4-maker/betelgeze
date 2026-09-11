"use client"

import { Avatar } from "@/components/account/Avatar"
import { RoundPill } from "./RoundPill"
import { openWorkspaceMemberProfile } from "@/lib/workspace-member-profile"

export function Assignee({ name, avatarSrc, userId, compact = false, compactSize = "sm", className = "" }: { name: string; avatarSrc?: string | null; userId?: string | null; compact?: boolean; compactSize?: "sm" | "md"; className?: string }) {
    const avatarSize = compact ? compactSize === "md" ? "h-6 w-6" : "h-[18px] w-[18px]" : "h-4 w-4"
    const avatar = <Avatar src={avatarSrc} name={name} className={avatarSize} />
    // Keep the profile control square instead of inheriting the mobile ordinary-button minimum height.
    const trigger = userId ? <button type="button" data-icon-button aria-label={`Open ${name} profile`} title={`Open ${name} profile`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(userId) }} className={`inline-flex shrink-0 items-center justify-center rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${avatarSize}`}>{avatar}</button> : avatar
    if (compact) return <span className={`inline-flex shrink-0 ${className}`} title={name}>{trigger}</span>
    return <RoundPill leading={trigger} className={className}>{name}</RoundPill>
}
