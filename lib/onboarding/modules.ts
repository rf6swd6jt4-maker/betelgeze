export type StepKind = "video" | "form"

export type ModuleStep = {
    key: string
    title: string
    description: string
    kind: StepKind
    formKey?: string
    videoUrl?: string
}

export type ModuleDefinition = {
    key: string
    title: string
    steps: ModuleStep[]
}

export const MODULES: Record<string, ModuleDefinition> = {
    "general-info": {
        key: "general-info",
        title: "General Info",
        steps: [
            {
                key: "web-access",
                title: "Website Access",
                description:
                    "Share access to your current website, domain, hosting, or website builder if you have one.",
                kind: "form",
                formKey: "web-access",
            },
            {
                key: "business-info",
                title: "Business Information",
                description:
                    "Tell us where you operate, what services you provide, and the areas you want to target.",
                kind: "form",
                formKey: "business-info",
            },
            {
                key: "cta-information",
                title: "Call-to-Action Information",
                description:
                    "Tell us what you want customers to do, such as call, request a quote, book a visit, or fill out a form.",
                kind: "form",
                formKey: "cta-information",
            },
            {
                key: "usps",
                title: "Why Customers Choose You",
                description:
                    "Tell us what makes your business different, better, faster, more reliable, or more trusted than competitors.",
                kind: "form",
                formKey: "usps",
            },
            {
                key: "competitors",
                title: "Competitors",
                description:
                    "Share competitors or similar businesses so we understand your local market.",
                kind: "form",
                formKey: "competitors",
            },
            {
                key: "accreditations",
                title: "Accreditations and Trust Signals",
                description:
                    "Share qualifications, trade memberships, certifications, guarantees, awards, or insurance details.",
                kind: "form",
                formKey: "accreditations",
            },
            {
                key: "process",
                title: "Your Process",
                description:
                    "Explain how a customer usually works with you from first contact to completed job.",
                kind: "form",
                formKey: "process",
            },
            {
                key: "history",
                title: "Business History",
                description:
                    "Tell us how the business started, how long you have been operating, and anything that builds trust.",
                kind: "form",
                formKey: "history",
            },
        ],
    },

    "google-search-ads": {
        key: "google-search-ads",
        title: "Google Search Ads",
        steps: [
            {
                key: "ga-access",
                title: "Google Analytics Access",
                description:
                    "Share Google Analytics access so we can understand website traffic and track important actions.",
                kind: "video",
                videoUrl: "",
            },
            {
                key: "gtm-access",
                title: "Google Tag Manager Access",
                description:
                    "Share Google Tag Manager access so we can set up tracking without repeatedly editing your website.",
                kind: "video",
                videoUrl: "",
            },
        ],
    },

    "website-lp": {
        key: "website-lp",
        title: "Website / Landing Page Assets",
        steps: [
            {
                key: "logo",
                title: "Logo",
                description:
                    "Upload or share your logo so we can use the correct brand assets.",
                kind: "form",
                formKey: "logo",
            },
            {
                key: "before-after-images",
                title: "Job Site Before and After Images",
                description:
                    "Share examples of completed work, especially before and after photos if you have them.",
                kind: "form",
                formKey: "before-after-images",
            },
            {
                key: "team-pictures",
                title: "Team Pictures",
                description:
                    "Share photos of you, your team, vans, workshop, or job sites to make the business feel trustworthy.",
                kind: "form",
                formKey: "team-pictures",
            },
            {
                key: "branding",
                title: "Colours, Slogan, and Branding",
                description:
                    "Share preferred colours, slogans, fonts, existing branding, or examples you like.",
                kind: "form",
                formKey: "branding",
            },
            {
                key: "video-assets",
                title: "Video Assets",
                description:
                    "Share any videos of your team, jobs, testimonials, vehicles, workshop, or finished work.",
                kind: "form",
                formKey: "video-assets",
            },
        ],
    },
}