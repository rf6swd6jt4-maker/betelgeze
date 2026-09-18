/* eslint-disable @next/next/no-img-element */
import Link from "next/link"
import { Children, type ReactNode } from "react"

function FilePreview({ contentType }: { contentType?: string | null }) {
    const label = contentType?.split("/").at(-1)?.replace("vnd.openxmlformats-officedocument.", "")?.slice(0, 12) || "file"
    return <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-900 text-neutral-500">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></svg>
        <span className="max-w-full truncate px-2 text-[10px] uppercase tracking-wide">{label}</span>
    </span>
}

export function AttachmentsBlock({ children, actions, description, empty = "No attachments yet." }: {
    children?: ReactNode
    actions?: ReactNode
    description?: ReactNode
    empty?: ReactNode
}) {
    const renderedChildren = Children.toArray(children)
    return <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-4 sm:p-5" aria-label="Attachments">
        <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Attachments</h2>
            {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div> : null}
        </div>
        {description ? <div className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500">{description}</div> : null}
        {renderedChildren.length ? <div className="mt-4 grid min-w-0 grid-cols-2 items-start gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">{renderedChildren}</div> : <p className="mt-4 text-sm text-neutral-500">{empty}</p>}
    </section>
}

export function AttachmentPreview({ href, title, subtitle, previewUrl, contentType, actions }: {
    href: string
    title: string
    subtitle?: ReactNode
    previewUrl?: string | null
    contentType?: string | null
    actions?: ReactNode
}) {
    return <article className="min-w-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/70">
        <Link href={href} className="group block min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500">
            <span className="block aspect-[4/3] overflow-hidden border-b border-neutral-800 bg-neutral-900">
                {previewUrl ? <img src={previewUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-[1.02]" /> : <FilePreview contentType={contentType} />}
            </span>
            <span className="block min-w-0 p-2.5">
                <span className="line-clamp-2 text-sm font-medium leading-5 text-neutral-100">{title}</span>
                {subtitle ? <span className="mt-1 block truncate text-xs text-neutral-500">{subtitle}</span> : null}
            </span>
        </Link>
        {actions ? <div className="border-t border-neutral-800 p-2">{actions}</div> : null}
    </article>
}
