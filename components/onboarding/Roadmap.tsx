"use client"

import { useState } from "react"

type RoadmapStep = {
    key: string
    title: string
    complete: boolean
    current: boolean
}

type RoadmapProps = {
    steps: RoadmapStep[]
}

function RoadmapItems({ steps }: RoadmapProps) {
    return (
        <div className="space-y-3">
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
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
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
    )
}

export function Roadmap({ steps }: RoadmapProps) {
    const [open, setOpen] = useState(false)

    return (
        <aside className="rounded-2xl border border-slate-200 bg-white p-5">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between text-left lg:pointer-events-none"
            >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Project setup
                </p>

                <span className="text-sm text-slate-500 lg:hidden">
                    {open ? "−" : "+"}
                </span>
            </button>

            <div className={`${open ? "mt-5 block" : "hidden"} lg:mt-5 lg:block`}>
                <RoadmapItems steps={steps} />
            </div>
        </aside>
    )
}