export type ServiceSopStep = {
    key: string
    title: string
    description?: string
}

export type ServiceDefinition = {
    key: string
    title: string
    description: string
    requiredModuleKeys: string[]
    sopSteps: ServiceSopStep[]
}

export const SERVICES: Record<string, ServiceDefinition> = {
    "landing-page-creation": {
        key: "landing-page-creation",
        title: "Landing Page Creation",
        description:
            "Fulfilment work for landing page planning, copy, design, build, QA, and launch preparation.",
        requiredModuleKeys: ["website-lp"],
        sopSteps: [],
    },
    "google-ads": {
        key: "google-ads",
        title: "Google Search Ads",
        description:
            "Fulfilment work for Google Search Ads setup, tracking, launch, and ongoing campaign preparation.",
        requiredModuleKeys: ["google-search-ads"],
        sopSteps: [],
    },
    "full-website-design": {
        key: "full-website-design",
        title: "Full Website Design",
        description:
            "Fulfilment work for full website structure, copy, design, build, QA, and launch preparation.",
        requiredModuleKeys: ["website-lp"],
        sopSteps: [],
    },
    seo: {
        key: "seo",
        title: "SEO",
        description:
            "Fulfilment work for SEO planning, technical review, on-page improvements, and content direction.",
        requiredModuleKeys: [],
        sopSteps: [],
    },
}

export function getModuleKeysForServices(serviceKeys: string[]) {
    const moduleKeys = new Set<string>(["general-info"])

    for (const serviceKey of serviceKeys) {
        const service = SERVICES[serviceKey]

        for (const moduleKey of service?.requiredModuleKeys ?? []) {
            moduleKeys.add(moduleKey)
        }
    }

    return [...moduleKeys]
}
