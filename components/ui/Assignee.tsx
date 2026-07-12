import { Avatar } from "@/components/account/Avatar"
import { RoundPill } from "./RoundPill"

export function Assignee({ name, avatarSrc, compact = false, className = "" }: { name: string; avatarSrc?: string | null; compact?: boolean; className?: string }) {
    if (compact) return <span className={`inline-flex shrink-0 ${className}`} title={name}><Avatar src={avatarSrc} name={name} className="h-5 w-5" /></span>
    return <RoundPill leading={<Avatar src={avatarSrc} name={name} className="h-4 w-4" />} className={className}>{name}</RoundPill>
}
