export type ModuleDefinition = {
    key: string
    title: string
    steps: {
        key: string
        title: string
        description: string
    }[]
}

export const MODULES: Record<string, ModuleDefinition> = {
    "landing-page": {
        key: "landing-page",
        title: "Landing Page Creation",
        steps: [
            {
                key: "lp-brand",
                title: "Brand Information",
                description:
                    "Tell us about your company, services and branding.",
            },
            {
                key: "lp-domain",
                title: "Domain Information",
                description:
                    "Provide domain and hosting information.",
            },
            {
                key: "lp-design",
                title: "Design Preferences",
                description:
                    "Show us examples and design preferences.",
            },
        ],
    },

    "full-website": {
        key: "full-website",
        title: "Website Creation",
        steps: [
            {
                key: "web-structure",
                title: "Website Structure",
                description:
                    "Tell us which pages and features are needed.",
            },
            {
                key: "web-content",
                title: "Content Collection",
                description:
                    "Provide content, imagery and assets.",
            },
        ],
    },

    "google-search-ads": {
        key: "google-search-ads",
        title: "Google Search Ads",
        steps: [
            {
                key: "ga4-access",
                title: "GA4 Access",
                description:
                    "Grant Google Analytics access.",
            },
            {
                key: "gtm-access",
                title: "GTM Access",
                description:
                    "Grant Google Tag Manager access.",
            },
            {
                key: "google-ads-access",
                title: "Google Ads Access",
                description:
                    "Grant Google Ads account access.",
            },
        ],
    },

    "full-seo": {
        key: "full-seo",
        title: "Full SEO",
        steps: [
            {
                key: "gsc-access",
                title: "Search Console Access",
                description:
                    "Grant Search Console access.",
            },
        ],
    },

    "ai-voice-automation": {
        key: "ai-voice-automation",
        title: "AI Voice Automation",
        steps: [
            {
                key: "phone-system",
                title: "Phone System Information",
                description:
                    "Tell us about your current setup.",
            },
            {
                key: "call-handling",
                title: "Call Handling Rules",
                description:
                    "Define how calls should be handled.",
            },
        ],
    },
}