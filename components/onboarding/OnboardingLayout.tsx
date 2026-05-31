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
        <main className="h-screen overflow-hidden bg-[#F8F7F3] text-slate-900">
            <header className="h-16 border-b border-slate-200 bg-white px-4 sm:px-6">
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[#1E3A5F]">
                        GPG Studios
                    </p>

                    <p className="hidden text-sm text-slate-500 sm:block">
                        Progress saved automatically
                    </p>
                </div>
            </header>

            <div className="mx-auto grid h-[calc(100vh-4rem)] max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_260px]">
                <div className="hidden lg:block">
                    <div className="sticky top-6">
                        <Roadmap steps={roadmapSteps} />
                    </div>
                </div>

                <section className="min-w-0 overflow-y-auto pb-10">
                    <div className="mb-6 lg:hidden">
                        <Roadmap steps={roadmapSteps} />
                    </div>

                    {children}

                    <div className="mt-6 lg:hidden">
                        <NeedHelpCard />
                    </div>
                </section>

                <div className="hidden lg:block">
                    <div className="sticky top-6">
                        <NeedHelpCard />
                    </div>
                </div>
            </div>
        </main>
    )
}