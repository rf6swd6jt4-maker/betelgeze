type RoadmapStep = {
    key: string
    title: string
    complete: boolean
    current: boolean
}

type RoadmapProps = {
    steps: RoadmapStep[]
}

export function Roadmap({ steps }: RoadmapProps) {
    return (
        <aside className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Project setup
            </p>

            <div className="mt-5 space-y-3">
                {steps.map((step) => (
                    <div
                        key={step.key}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                            step.current
                                ? "bg-blue-50 text-[#1E3A5F]"
                                : "text-slate-600"
                        }`}
                    >
                        <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                                step.complete
                                    ? "border-[#1E3A5F] bg-[#1E3A5F] text-white"
                                    : step.current
                                      ? "border-[#F0B429] bg-[#F0B429] text-slate-950"
                                      : "border-slate-300"
                            }`}
                        >
                            {step.complete ? "✓" : step.current ? "→" : ""}
                        </span>

                        <span className="font-medium">{step.title}</span>
                    </div>
                ))}
            </div>
        </aside>
    )
}