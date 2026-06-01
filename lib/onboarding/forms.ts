export type FormFieldType =
    | "text"
    | "email"
    | "tel"
    | "url"
    | "textarea"
    | "file"

export type FileAccept = "image" | "video" | "document" | "any"

export type FormFieldDefinition = {
    name: string
    label: string
    type: FormFieldType
    required?: boolean
    helpText?: string
    placeholder?: string
    accept?: FileAccept
    multiple?: boolean
}

export type OnboardingFormDefinition = {
    key: string
    title: string
    intro: string
    fields: FormFieldDefinition[]
}

export type StoredUpload = {
    name: string
    path: string
    size: number
    type: string
    kind: FileAccept
}

export type FormResponseValue = string | StoredUpload[]

export type FormResponse = Record<string, FormResponseValue>

export const ONBOARDING_FORMS: Record<string, OnboardingFormDefinition> = {
    "web-access": {
        key: "web-access",
        title: "Website access",
        intro:
            "Tell us how to access your current website or website accounts. If you are unsure, share whatever you have and we will guide you.",
        fields: [
            {
                name: "website_url",
                label: "Current website address",
                type: "url",
                placeholder: "https://example.com",
                helpText: "Leave blank if you do not have a website yet.",
            },
            {
                name: "website_platform",
                label: "Website platform or provider",
                type: "text",
                placeholder: "WordPress, Wix, Squarespace, Shopify, GoDaddy...",
            },
            {
                name: "access_details",
                label: "Access details or invitation notes",
                type: "textarea",
                required: true,
                placeholder:
                    "Tell us who owns the account, what email it is under, or how you plan to share access.",
            },
            {
                name: "extra_files",
                label: "Helpful screenshots or documents",
                type: "file",
                accept: "any",
                multiple: true,
                helpText:
                    "Optional. Upload screenshots, login instructions, or documents that help explain the setup.",
            },
        ],
    },
    "business-info": {
        key: "business-info",
        title: "Business information",
        intro:
            "Share the basics we need to understand your business, service area, and ideal customers.",
        fields: [
            {
                name: "business_name",
                label: "Business name",
                type: "text",
                required: true,
            },
            {
                name: "main_location",
                label: "Main location",
                type: "text",
                required: true,
                placeholder: "Town, city, county, or region",
            },
            {
                name: "service_areas",
                label: "Areas you serve",
                type: "textarea",
                required: true,
                placeholder:
                    "List towns, counties, postcodes, or the radius you are happy to travel.",
            },
            {
                name: "services",
                label: "Main services you offer",
                type: "textarea",
                required: true,
                placeholder:
                    "Example: emergency plumbing, boiler installs, bathroom fitting...",
            },
            {
                name: "ideal_customer",
                label: "Ideal customer or job type",
                type: "textarea",
                placeholder:
                    "Tell us which jobs are most profitable or most important to attract.",
            },
        ],
    },
    "cta-information": {
        key: "cta-information",
        title: "Call-to-action information",
        intro:
            "Tell us what you want people to do after they find your business.",
        fields: [
            {
                name: "primary_action",
                label: "Main action you want customers to take",
                type: "textarea",
                required: true,
                placeholder:
                    "Call, request a quote, book online, WhatsApp, fill in a form...",
            },
            {
                name: "phone",
                label: "Best phone number",
                type: "tel",
                placeholder: "+353...",
            },
            {
                name: "email",
                label: "Best enquiry email",
                type: "email",
            },
            {
                name: "booking_link",
                label: "Booking or quote link",
                type: "url",
                placeholder: "https://...",
            },
            {
                name: "important_notes",
                label: "Anything customers should know before contacting you?",
                type: "textarea",
            },
        ],
    },
    usps: {
        key: "usps",
        title: "Why customers choose you",
        intro:
            "Help us understand what makes your business more trustworthy, reliable, or valuable than competitors.",
        fields: [
            {
                name: "unique_points",
                label: "Your strongest selling points",
                type: "textarea",
                required: true,
                placeholder:
                    "Examples: same-day callouts, family-run, fully insured, 20 years experience...",
            },
            {
                name: "guarantees",
                label: "Guarantees, warranties, or promises",
                type: "textarea",
            },
            {
                name: "reviews",
                label: "Review links or testimonial notes",
                type: "textarea",
                placeholder:
                    "Google review profile, Trustpilot, Facebook reviews, or copied testimonials.",
            },
        ],
    },
    competitors: {
        key: "competitors",
        title: "Competitors",
        intro:
            "Share competitors or similar businesses so we can understand your market and positioning.",
        fields: [
            {
                name: "competitors",
                label: "Competitor names or websites",
                type: "textarea",
                required: true,
                placeholder:
                    "Paste websites or list businesses customers might compare you against.",
            },
            {
                name: "likes_dislikes",
                label: "What do you like or dislike about them?",
                type: "textarea",
            },
        ],
    },
    accreditations: {
        key: "accreditations",
        title: "Accreditations and trust signals",
        intro:
            "Add anything that builds trust: memberships, certifications, awards, insurance, or qualifications.",
        fields: [
            {
                name: "trust_signals",
                label: "Accreditations, memberships, or qualifications",
                type: "textarea",
                required: true,
            },
            {
                name: "trust_files",
                label: "Certificates, badges, or proof documents",
                type: "file",
                accept: "any",
                multiple: true,
            },
        ],
    },
    process: {
        key: "process",
        title: "Your process",
        intro:
            "Explain what usually happens from the first customer enquiry to a completed job.",
        fields: [
            {
                name: "process",
                label: "How your process works",
                type: "textarea",
                required: true,
                placeholder:
                    "Example: phone call, site visit, quote, deposit, schedule work, completion...",
            },
            {
                name: "timelines",
                label: "Typical timings",
                type: "textarea",
                placeholder:
                    "How quickly do you respond, quote, book in, or complete common jobs?",
            },
        ],
    },
    history: {
        key: "history",
        title: "Business history",
        intro:
            "Tell us your story so we can make your business feel more credible and human.",
        fields: [
            {
                name: "story",
                label: "How did the business get started?",
                type: "textarea",
                required: true,
            },
            {
                name: "experience",
                label: "Years of experience and background",
                type: "textarea",
            },
        ],
    },
    logo: {
        key: "logo",
        title: "Logo",
        intro:
            "Upload your logo if you have one. High-quality files help us keep your branding sharp.",
        fields: [
            {
                name: "logo_files",
                label: "Logo files",
                type: "file",
                required: true,
                accept: "image",
                multiple: true,
                helpText:
                    "PNG, JPG, SVG, or PDF files are useful. Upload all versions you have.",
            },
            {
                name: "logo_notes",
                label: "Logo notes",
                type: "textarea",
                placeholder:
                    "Tell us which version to use, or if you want us to clean anything up.",
            },
        ],
    },
    "before-after-images": {
        key: "before-after-images",
        title: "Job site before and after images",
        intro:
            "Upload examples of your work. Before-and-after photos are especially useful for ads and landing pages.",
        fields: [
            {
                name: "job_images",
                label: "Before and after images",
                type: "file",
                accept: "image",
                multiple: true,
                required: true,
            },
            {
                name: "image_context",
                label: "What do these images show?",
                type: "textarea",
                placeholder:
                    "Example: kitchen renovation in Cork, driveway cleaning in Dublin...",
            },
        ],
    },
    "team-pictures": {
        key: "team-pictures",
        title: "Team pictures",
        intro:
            "Upload team, van, workshop, or on-site photos that help real customers trust you.",
        fields: [
            {
                name: "team_images",
                label: "Team or business photos",
                type: "file",
                accept: "image",
                multiple: true,
                required: true,
            },
            {
                name: "photo_notes",
                label: "Who or what is in the photos?",
                type: "textarea",
            },
        ],
    },
    branding: {
        key: "branding",
        title: "Colours, slogan, and branding",
        intro:
            "Share your preferred colours, slogans, style, and examples of brands or websites you like.",
        fields: [
            {
                name: "colours",
                label: "Preferred colours",
                type: "textarea",
                placeholder:
                    "Example: navy and gold, green and white, use colours from our logo...",
            },
            {
                name: "slogan",
                label: "Slogan or key phrase",
                type: "text",
            },
            {
                name: "style_preferences",
                label: "Style preferences",
                type: "textarea",
                placeholder:
                    "Modern, premium, friendly, family-run, emergency-focused...",
            },
            {
                name: "inspiration",
                label: "Websites or brands you like",
                type: "textarea",
            },
            {
                name: "brand_files",
                label: "Branding files or examples",
                type: "file",
                accept: "any",
                multiple: true,
            },
        ],
    },
    "video-assets": {
        key: "video-assets",
        title: "Video assets",
        intro:
            "Upload any videos that show your team, work, vehicles, testimonials, or finished jobs.",
        fields: [
            {
                name: "videos",
                label: "Video files",
                type: "file",
                accept: "video",
                multiple: true,
                required: true,
            },
            {
                name: "video_notes",
                label: "What do the videos show?",
                type: "textarea",
            },
        ],
    },
}

export function getOnboardingForm(formKey?: string) {
    if (!formKey) return null

    return ONBOARDING_FORMS[formKey] ?? null
}

export function getFileAcceptValue(accept?: FileAccept) {
    switch (accept) {
        case "image":
            return "image/*,.svg,.pdf"
        case "video":
            return "video/*"
        case "document":
            return ".pdf,.doc,.docx,.txt"
        default:
            return undefined
    }
}

export function getUploadKind(contentType: string): FileAccept {
    if (contentType.startsWith("image/")) return "image"
    if (contentType.startsWith("video/")) return "video"

    return "document"
}
