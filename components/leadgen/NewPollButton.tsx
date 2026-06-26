"use client"

import Link from "next/link"
import type { ReactNode } from "react"

type NewPollButtonProps = {
    href?: string
    warnAboutOsmOnly?: boolean
    children?: ReactNode
}

const OSM_ONLY_WARNING = "This workspace is currently configured to poll using only OpenStreetMap/Overpass.\n\nThat source is free and useful, but it runs through public Overpass infrastructure. Requests can be rate-limited or temporarily unavailable, so some polls may fail until we add more sources.\n\nDo you still want to run this poll?"

const buttonClassName = "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3"

export function NewPollButton({ href, warnAboutOsmOnly = false, children = "New Poll" }: NewPollButtonProps) {
    if (href) return <Link href={href} className={buttonClassName}>{children}</Link>
    return <button
        className={buttonClassName}
        onClick={(event) => {
            if (!warnAboutOsmOnly) return
            if (!window.confirm(OSM_ONLY_WARNING)) event.preventDefault()
        }}
        type="submit"
    >
        {children}
    </button>
}
