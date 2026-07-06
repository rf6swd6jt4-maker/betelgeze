"use client"

import { useEffect, useState } from "react"

export type SettingsSectionNavItem = {
    id: string
    label: string
    detail: string
}

export function SettingsSectionNav({ sections }: { sections: SettingsSectionNavItem[] }) {
    const [active, setActive] = useState(sections[0]?.id ?? "")

    useEffect(() => {
        const nodes = sections
            .map((section) => document.getElementById(section.id))
            .filter((node): node is HTMLElement => Boolean(node))
        if (!nodes.length) return

        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
            if (visible?.target.id) setActive(visible.target.id)
        }, {
            rootMargin: "-18% 0px -62% 0px",
            threshold: [0.05, 0.15, 0.3, 0.6],
        })

        nodes.forEach((node) => observer.observe(node))
        return () => observer.disconnect()
    }, [sections])

    function scrollToSection(id: string) {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    return (
        <nav className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto lg:block">
            <div className="space-y-1 border-l border-neutral-800 pl-2">
                {sections.map((section) => {
                    const selected = active === section.id
                    return (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => scrollToSection(section.id)}
                            className={`w-full rounded-lg px-3 py-2.5 text-left transition ${selected ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-900/60 hover:text-neutral-200"}`}
                        >
                            <span className="block text-sm font-medium">{section.label}</span>
                            <span className="mt-0.5 block text-xs leading-4 text-neutral-500">{section.detail}</span>
                        </button>
                    )
                })}
            </div>
        </nav>
    )
}
