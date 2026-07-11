import { Avatar } from "@/components/account/Avatar"
import { Pill } from "./Pill"

export function AssignmentPill({ name, avatarSrc, className = "" }: { name: string; avatarSrc?: string | null; className?: string }) {
    return <Pill leading={<Avatar src={avatarSrc} name={name} className="h-4 w-4" />} className={className}>{name}</Pill>
}
