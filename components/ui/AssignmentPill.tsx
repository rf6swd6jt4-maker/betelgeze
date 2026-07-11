import { Avatar } from "@/components/account/Avatar"
import { RoundPill } from "./RoundPill"

export function AssignmentPill({ name, avatarSrc, className = "" }: { name: string; avatarSrc?: string | null; className?: string }) {
    return <RoundPill leading={<Avatar src={avatarSrc} name={name} className="h-4 w-4" />} className={className}>{name}</RoundPill>
}
