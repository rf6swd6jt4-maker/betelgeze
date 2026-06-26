/* eslint-disable @next/next/no-img-element */
import { Avatar } from "@/components/account/Avatar"

export function ListCreatorAvatar({ src, username, className = "h-7 w-7" }: { src?: string | null; username?: string | null; className?: string }) {
    if (src) return <Avatar src={src} name={username ?? "Creator"} className={className} />

    return <img src="/brand/betelgeze-logo.svg" alt="Betelgeze automation" className={`${className} rounded-full object-cover`} />
}
