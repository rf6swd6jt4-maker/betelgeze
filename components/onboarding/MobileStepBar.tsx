type MobileStepBarProps = {
    steps: {
        key: string
        title: string
        complete: boolean
        current: boolean
    }[]
}

export function MobileStepBar({ steps }: MobileStepBarProps) {
    const currentIndex = steps.findIndex((step) => step.current)
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0

    const currentStep = steps[safeCurrentIndex]
    const stepNumber = safeCurrentIndex + 1

    const visibleCount = 4
    let startIndex = safeCurrentIndex

    if (startIndex > steps.length - visibleCount) {
        startIndex = Math.max(steps.length - visibleCount, 0)
    }

    const visibleSteps = steps.slice(startIndex, startIndex + visibleCount)

    const showLeftLine = startIndex > 0
    const showRightLine = startIndex + visibleSteps.length < steps.length

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] lg:hidden">
            <div className="mx-auto max-w-md">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Current step
                        </p>

                        <p className="truncate text-sm font-semibold text-[#1E3A5F]">
                            {currentStep?.title ?? "Onboarding"}
                        </p>
                    </div>

                    <p className="shrink-0 text-sm font-medium text-slate-500">
                        {stepNumber} of {steps.length}
                    </p>
                </div>

                <p className="mb-3 text-center text-xs font-medium text-slate-500">
                    Progress saved automatically
                </p>

                <div className="grid grid-cols-[0.5fr_36px_1fr_36px_1fr_36px_1fr_36px_0.25fr] items-center">
                    <div
                        className={`h-0.5 ${
                            showLeftLine ? "bg-slate-300" : "bg-transparent"
                        }`}
                    />

                    {visibleSteps.map((step, visibleIndex) => {
                        const actualIndex = startIndex + visibleIndex
                        const isLastVisible =
                            visibleIndex === visibleSteps.length - 1

                        return (
                            <div key={step.key} className="contents">
                                <div
                                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[#1E3A5F] bg-[#1E3A5F] text-white"
                                            : step.current
                                              ? "border-[#F0B429] bg-[#F0B429] text-slate-950"
                                              : "border-slate-300 bg-white text-slate-500"
                                    }`}
                                >
                                    {step.complete ? "✓" : actualIndex + 1}
                                </div>

                                {!isLastVisible && (
                                    <div className="h-0.5 bg-slate-300" />
                                )}
                            </div>
                        )
                    })}

                    <div
                        className={`h-0.5 ${
                            showRightLine ? "bg-slate-300" : "bg-transparent"
                        }`}
                    />
                </div>
            </div>
        </div>
    )
}
