import type { RecordReference } from "@/lib/communications/references"

export const REFERENCE_ICON_PATHS: Record<RecordReference["type"], string[]> = {
    work_item: ["M8 6h13M8 12h13M8 18h13", "m3 6 .8.8L5.5 5m-2.5 7 .8.8 1.7-1.8m-2.5 7 .8.8 1.7-1.8"],
    asset: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M9.5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z", "m4 17 5-5 4 4 2-2 5 5"],
    relationship: ["M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 21a5 5 0 0 1 10 0m-1 0a5 5 0 0 1 9 0"],
}

/** The existing workspace icons, sized for compact references and picker rows. */
export function ReferenceIcon({ type, className = "h-4 w-4" }: { type: RecordReference["type"]; className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 fill-none stroke-current stroke-2 ${className}`}>
        {REFERENCE_ICON_PATHS[type].map(path => <path key={path} d={path} />)}
    </svg>
}
