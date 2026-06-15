export type ServiceSopStep = {
    key: string
    title: string
    description?: string
}

export type ServiceDefinition = {
    key: string
    title: string
    description: string
    defaultModuleKeys: string[]
    sopSteps: ServiceSopStep[]
}

export const SERVICES: Record<string, ServiceDefinition> = {
    "google-ads": {
        key: "google-ads",
        title: "Google Ads",
        description:
            "Fulfilment work for Google Search Ads setup, tracking, launch, and ongoing campaign preparation.",
        defaultModuleKeys: ["google-search-ads"],
        sopSteps: [],
    },
    "landing-page": {
        key: "landing-page",
        title: "Landing Page",
        description:
            "Fulfilment work for landing page planning, copy, design, build, QA, and launch preparation.",
        defaultModuleKeys: ["website-lp"],
        sopSteps: [],
    },
}

export function getDefaultServiceKeysForModules(moduleKeys: string[]) {
    const selectedModules = new Set(moduleKeys)

    return Object.values(SERVICES)
        .filter((service) =>
            service.defaultModuleKeys.some((moduleKey) =>
                selectedModules.has(moduleKey)
            )
        )
        .map((service) => service.key)
}
