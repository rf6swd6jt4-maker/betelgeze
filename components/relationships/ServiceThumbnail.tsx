import type { RelationshipServiceRow } from "@/lib/service-stages"
import { SERVICE_TEMPLATES } from "@/lib/onboarding/service-templates"
export function ServiceThumbnail({ service }: { service: Pick<RelationshipServiceRow, "name" | "thumbnailUrl" | "templateId"> }) {
    const source = service.thumbnailUrl ?? SERVICE_TEMPLATES.find(template => template.id === service.templateId)?.thumbnail.src
    // Public template assets and authorized, short-lived private thumbnails are already sized by the card.
    // eslint-disable-next-line @next/next/no-img-element
    return source ? <img src={source} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{service.name.slice(0, 1)}</span>
}
