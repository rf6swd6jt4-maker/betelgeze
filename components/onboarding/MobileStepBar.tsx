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

    const maxVisibleSteps = 4

    let startIndex = safeCurrentIndex

    if (startIndex > steps.length - maxVisibleSteps) {
        startIndex = Math.max(steps.length - maxVisibleSteps, 0)
    }

    const visibleSteps = steps.slice(startIndex, startIndex + maxVisibleSteps)

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

                <div className="flex items-center">
                    {visibleSteps.map((step, visibleIndex) => {
                        const actualIndex = startIndex + visibleIndex

                        return (
                            <div
                                key={step.key}
                                className="flex flex-1 items-center"
                            >
                                <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[#1E3A5F] bg-[#1E3A5F] text-white"
                                            : step.current
                                              ? "border-[#F0B429] bg-[#F0B429] text-slate-950"
                                              : "border-slate-300 bg-white text-slate-500"
                                    }`}
                                >
                                    {step.complete ? "✓" : actualIndex + 1}
                                </div>

                                {visibleIndex < visibleSteps.length - 1 && (
                                    <div className="h-0.5 flex-1 bg-slate-300" />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}