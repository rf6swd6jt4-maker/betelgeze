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
        <main className="min-h-screen bg-[#F8F7F3] text-slate-900">
            <header className="sticky top-0 z-20 h-16 border-b border-slate-200 bg-white px-4 sm:px-6">
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[#1E3A5F]">
                        ScaylUp
                    </p>

                    <p className="hidden text-sm text-slate-500 sm:block">
                        Progress saved automatically
                    </p>
                </div>
            </header>

            <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-32 pt-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_260px] lg:py-6">
                <div className="hidden lg:block">
                    <div className="sticky top-22">
                        <Roadmap steps={roadmapSteps} />
                    </div>
                </div>

                <section className="min-w-0">{children}</section>

                <div className="hidden lg:block">
                    <div className="sticky top-22">
                        <NeedHelpCard />
                    </div>
                </div>

                <div className="lg:hidden">
                    <NeedHelpCard />
                </div>
            </div>

            <MobileStepBar steps={roadmapSteps} />
        </main>
    )
}