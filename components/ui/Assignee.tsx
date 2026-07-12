import { Avatar } from "@/components/account/Avatar"
import { RoundPill } from "./RoundPill"

export function Assignee({ name, avatarSrc, compact = false, compactSize = "sm", className = "" }: { name: string; avatarSrc?: string | null; compact?: boolean; compactSize?: "sm" | "md"; className?: string }) {
    if (compact) return <span className={`inline-flex shrink-0 ${className}`} title={name}><Avatar src={avatarSrc} name={name} className={compactSize === "md" ? "h-6 w-6" : "h-[18px] w-[18px]"} /></span>
    return <RoundPill leading={<Avatar src={avatarSrc} name={name} className="h-4 w-4" />} className={className}>{name}</RoundPill>
}
