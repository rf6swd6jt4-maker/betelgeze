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

    const currentStep = steps[currentIndex] ?? steps[0]
    const stepNumber = currentIndex >= 0 ? currentIndex + 1 : 1

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] lg:hidden">
            <div className="mx-auto max-w-md">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Current step
                        </p>

                        <p className="max-w-[230px] truncate text-sm font-semibold text-[#1E3A5F]">
                            {currentStep?.title ?? "Onboarding"}
                        </p>
                    </div>

                    <p className="shrink-0 text-sm font-medium text-slate-500">
                        {stepNumber} of {steps.length}
                    </p>
                </div>

                <div className="flex items-center overflow-hidden">
                    {steps.map((step, index) => (
                        <div
                            key={step.key}
                            className="flex flex-1 items-center"
                        >
                            <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                                    step.complete
                                        ? "border-[#1E3A5F] bg-[#1E3A5F] text-white"
                                        : step.current
                                          ? "border-[#F0B429] bg-[#F0B429] text-slate-950"
                                          : "border-slate-300 bg-white text-slate-500"
                                }`}
                            >
                                {step.complete ? "✓" : index + 1}
                            </div>

                            {index < steps.length - 1 && (
                                <div
                                    className={`h-0.5 flex-1 ${
                                        step.complete
                                            ? "bg-[#1E3A5F]"
                                            : "bg-slate-200"
                                    }`}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}