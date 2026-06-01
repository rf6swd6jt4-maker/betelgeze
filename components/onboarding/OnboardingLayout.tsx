import { NeedHelpCard } from "./NeedHelpCard"
import { ProfileMenu } from "./ProfileMenu"
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
    client: {
        name: string | null
        email: string
    }
}

export function OnboardingLayout({
    children,
    roadmapSteps,
    client,
}: OnboardingLayoutProps) {
    return (
        <main className="flex min-h-screen flex-col bg-[#F8F7F3] text-slate-900 lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
            <header className="h-16 shrink-0 border-b border-slate-200 bg-white px-4 sm:px-6">
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[#1E3A5F]">
                        ScaylUp
                    </p>

                    <ProfileMenu name={client.name} email={client.email} />
                </div>
            </header>

            <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-32 pt-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)_260px] lg:overflow-hidden lg:py-6">
                <aside className="hidden lg:min-h-0 lg:overflow-hidden lg:block">
                    <Roadmap steps={roadmapSteps} />
                </aside>

                <section
                    id="onboarding-scroll-area"
                    className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-10"
                >
                    {children}

                    <div className="mt-6 lg:hidden">
                        <NeedHelpCard />
                    </div>
                </section>

                <aside className="hidden lg:min-h-0 lg:overflow-hidden lg:block">
                    <NeedHelpCard />
                </aside>
            </div>

            <div className="hidden shrink-0 border-t border-slate-200 bg-white px-6 py-3 text-center text-sm font-medium text-slate-500 lg:block">
                Progress saved automatically
            </div>

            <MobileStepBar steps={roadmapSteps} />
        </main>
    )
}
