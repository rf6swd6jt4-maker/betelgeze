import type { OnboardingBillingInterval, OnboardingServiceType } from "@/lib/onboarding/configuration-types"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

export type ServiceTemplateSetup =
    | { kind: "none" }
    | { kind: "connection"; connectionKey: string }

export type ServiceTemplateOnboardingBlock = {
    kind: "connection" | "google_ads_connection" | "appointment_medium" | "appointment_fields" | "crm_setup"
    label: string
}

export type ServiceTemplateDefinition = {
    id: string
    name: string
    description: string
    thumbnail: {
        src: string
        alt: string
    }
    serviceDefaults: {
        name: string
        description: string
        thumbnailSrc: string
        serviceType: OnboardingServiceType
        recurringName: string
        recurringDescription: string
        defaultBillingInterval: OnboardingBillingInterval
        defaultBillingIntervalCount: number
    }
    setup: ServiceTemplateSetup
    capabilities: readonly WorkspaceCapability[]
    onboardingBlocks: readonly ServiceTemplateOnboardingBlock[]
}

const metaAdsThumbnail = "/service-templates/meta-ads.png"
const appointmentSettingThumbnail = "/service-templates/appointment-setting.png"
const googleAdsThumbnail = "/service-templates/google-ads.svg"

export const SERVICE_TEMPLATES: readonly ServiceTemplateDefinition[] = [{
    id: "meta-ads",
    name: "Meta Ads",
    description: "Plan, launch, and manage paid campaigns across Facebook and Instagram.",
    thumbnail: {
        src: metaAdsThumbnail,
        alt: "Meta Ads service cover",
    },
    serviceDefaults: {
        name: "Meta Ads",
        description: "Plan, launch, and manage paid campaigns across Facebook and Instagram.",
        thumbnailSrc: metaAdsThumbnail,
        serviceType: "retainer",
        recurringName: "Meta Ads management",
        recurringDescription: "Ongoing planning, launch, and management of paid campaigns across Facebook and Instagram.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "connection", connectionKey: "windsor" },
    capabilities: ["onboarding.manage", "fulfilment.manage"],
    onboardingBlocks: [{ kind: "connection", label: "Meta Ads reporting connection" }],
}, {
    id: "appointment-setting",
    name: "Appointment Setting",
    description: "Manage leads, setter availability, bookings, and appointment outcomes.",
    thumbnail: {
        src: appointmentSettingThumbnail,
        alt: "Appointment Setting service cover",
    },
    serviceDefaults: {
        name: "Appointment Setting",
        description: "Manage leads, setter availability, bookings, and appointment outcomes.",
        thumbnailSrc: appointmentSettingThumbnail,
        serviceType: "retainer",
        recurringName: "Appointment setting",
        recurringDescription: "Ongoing lead follow-up, booking, and appointment outcome management.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "none" },
    capabilities: ["onboarding.manage", "fulfilment.manage"],
    onboardingBlocks: [{ kind: "crm_setup", label: "CRM setup" }],
}, {
    id: "google-search-ads",
    name: "Google Search Ads",
    description: "Plan, launch, and manage paid search campaigns on Google.",
    thumbnail: { src: googleAdsThumbnail, alt: "Google Ads service cover" },
    serviceDefaults: {
        name: "Google Search Ads",
        description: "Plan, launch, and manage paid search campaigns on Google.",
        thumbnailSrc: googleAdsThumbnail,
        serviceType: "retainer",
        recurringName: "Google Search Ads management",
        recurringDescription: "Ongoing planning, launch, and management of Google Search campaigns.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "connection", connectionKey: "google_ads" },
    capabilities: ["onboarding.manage", "fulfilment.manage"],
    onboardingBlocks: [{ kind: "google_ads_connection", label: "Google Ads connection" }],
}, {
    id: "google-local-services-ads",
    name: "Google Local Services Ads",
    description: "Manage Local Services Ads, lead delivery, and charged-lead performance.",
    thumbnail: { src: googleAdsThumbnail, alt: "Google Local Services Ads service cover" },
    serviceDefaults: {
        name: "Google Local Services Ads",
        description: "Manage Local Services Ads, lead delivery, and charged-lead performance.",
        thumbnailSrc: googleAdsThumbnail,
        serviceType: "retainer",
        recurringName: "Google Local Services Ads management",
        recurringDescription: "Ongoing management of Local Services Ads, lead delivery, and charged-lead performance.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "connection", connectionKey: "google_ads" },
    capabilities: ["onboarding.manage", "fulfilment.manage"],
    onboardingBlocks: [{ kind: "google_ads_connection", label: "Google Ads connection" }],
}]

/** Resolves a template-owned public cover without treating it as a workspace upload. */
export function serviceTemplateThumbnailSrc(templateId: string | null | undefined) {
    if (templateId === "google-ads") return googleAdsThumbnail
    return SERVICE_TEMPLATES.find((template) => template.id === templateId)?.thumbnail.src ?? null
}

/**
 * Older template-created revisions only stored templateId. A present
 * thumbnailTemplateId (including null) is authoritative so removing a cover
 * remains distinct from a legacy revision that has never chosen one.
 */
export function serviceTemplateThumbnailId(definition: Record<string, unknown>) {
    if (Object.hasOwn(definition, "thumbnailTemplateId")) {
        return typeof definition.thumbnailTemplateId === "string" ? definition.thumbnailTemplateId : null
    }
    if (Object.hasOwn(definition, "thumbnail_template_id")) {
        return typeof definition.thumbnail_template_id === "string" ? definition.thumbnail_template_id : null
    }
    const legacyTemplateId = definition.templateId ?? definition.template_id
    return typeof legacyTemplateId === "string" ? legacyTemplateId : null
}

export function serviceTemplateThumbnailSrcFromDefinition(definition: Record<string, unknown>) {
    return serviceTemplateThumbnailSrc(serviceTemplateThumbnailId(definition))
}
