import { NeedHelpCard } from "./NeedHelpCard"
import { Roadmap } from "./Roadmap"
import { MobileStepBar } from "./MobileStepBar"

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
        <main className="min-h-screen bg-[#F8F7F3] text-slate-900 lg:h-screen lg:overflow-hidden">
            <header className="h-16 border-b border-slate-200 bg-white px-4 sm:px-6">
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[#1E3A5F]">
                        ScaylUp
                    </p>

                    <p className="hidden text-sm text-slate-500 sm:block">
                        Progress saved automatically
                    </p>
                </div>
            </header>

            <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-32 pt-4 sm:px-6 lg:h-[calc(100vh-4rem)] lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_260px] lg:py-6">
                <aside className="hidden lg:block lg:min-h-0">
                    <Roadmap steps={roadmapSteps} />
                </aside>

                <section
                    id="onboarding-scroll-area"
                    className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-10"
                >
                    {children}

                    <div className="mt-6 lg:hidden">
                        <NeedHelpCard />
                    </div>
                </section>

                <aside className="hidden lg:block lg:min-h-0">
                    <NeedHelpCard />
                </aside>
            </div>

            <MobileStepBar steps={roadmapSteps} />
        </main>
    )
}