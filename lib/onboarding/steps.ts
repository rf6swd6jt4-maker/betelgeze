export type OnboardingStep = {
    key: string
    title: string
    description: string
    videoUrl?: string
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        key: "welcome-video",
        title: "Welcome",
        description: "Watch this short welcome video before starting.",
        videoUrl: "https://www.loom.com/embed/YOUR_LOOM_ID",
    },
    {
        key: "services",
        title: "Services purchased",
        description: "Confirm which services you purchased.",
    },
    {
        key: "ga4-access",
        title: "Google Analytics access",
        description: "Follow the instructions to share GA4 access with us.",
        videoUrl: "https://www.loom.com/embed/YOUR_GA4_VIDEO_ID",
    },
    {
        key: "gtm-access",
        title: "Google Tag Manager access",
        description: "Follow the instructions to share GTM access with us.",
        videoUrl: "https://www.loom.com/embed/YOUR_GTM_VIDEO_ID",
    },
    {
        key: "final",
        title: "All done",
        description: "You have completed the core onboarding steps.",
    },
]