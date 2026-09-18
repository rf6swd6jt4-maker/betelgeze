import type { RelationshipServiceRow } from "@/lib/service-stages"
export function ServiceThumbnail({ service }: { service: Pick<RelationshipServiceRow, "name" | "thumbnailUrl"> }) {
    const source = service.thumbnailUrl
    // Public template assets and authorized, short-lived private thumbnails are already sized by the card.
    // eslint-disable-next-line @next/next/no-img-element
    return source ? <img src={source} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{service.name.slice(0, 1)}</span>
}
