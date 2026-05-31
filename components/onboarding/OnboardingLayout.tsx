import { NeedHelpCard } from "./NeedHelpCard"
import { Roadmap } from "./Roadmap"

type RoadmapStep = {
    key: string
    title: string
    complete: boolean
    current: boolean
}

type OnboardingLayoutProps = {
    children: React.ReactNode
    roadmapSteps: RoadmapStep[]
}

export function OnboardingLayout({
    children,
    roadmapSteps,
}: OnboardingLayoutProps) {
    return (
        <main className="min-h-screen bg-[#F8F7F3] text-slate-900">
            <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[#1E3A5F]">
                        Client Onboarding
                    </p>

                    <p className="text-sm text-slate-500">
                        Progress saved automatically
                    </p>
                </div>
            </header>

            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_1fr_260px]">
                <div className="lg:sticky lg:top-6 lg:self-start">
                    <Roadmap steps={roadmapSteps} />
                </div>

                <section>{children}</section>

                <div className="lg:sticky lg:top-6 lg:self-start">
                    <NeedHelpCard />
                </div>
            </div>
        </main>
    )
}