"use client"

import { useEffect, useState } from "react"

export type SettingsSectionNavItem = {
    id: string
    label: string
    detail: string
}

export function SettingsSectionNav({ sections, scrollRootId }: { sections: SettingsSectionNavItem[]; scrollRootId?: string }) {
    const [active, setActive] = useState(sections[0]?.id ?? "")

    useEffect(() => {
        const nodes = sections
            .map((section) => document.getElementById(section.id))
            .filter((node): node is HTMLElement => Boolean(node))
        if (!nodes.length) return

        const root = scrollRootId ? document.getElementById(scrollRootId) : null
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
            if (visible?.target.id) setActive(visible.target.id)
        }, {
            root,
            rootMargin: "-14% 0px -64% 0px",
            threshold: [0.05, 0.15, 0.3, 0.6],
        })

        nodes.forEach((node) => observer.observe(node))
        return () => observer.disconnect()
    }, [sections, scrollRootId])

    function scrollToSection(id: string) {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    const activeIndex = Math.max(0, sections.findIndex((section) => section.id === active))

    return (
        <nav className="sticky top-20 hidden self-start lg:block">
            <div className="relative space-y-2 border-l border-neutral-800 pl-5">
                <span
                    aria-hidden="true"
                    className="absolute -left-px top-0 h-16 w-px bg-white transition-transform duration-300 ease-out"
                    style={{ transform: `translateY(${activeIndex * 4.5}rem)` }}
                />
                {sections.map((section) => {
                    const selected = active === section.id
                    return (
                        <button
                            key={section.id}
                            type="button"
                            onClick={() => scrollToSection(section.id)}
                            className={`block h-16 w-full text-left transition ${selected ? "text-white" : "text-neutral-500 hover:text-neutral-200"}`}
                        >
                            <span className="block text-base font-semibold leading-5">{section.label}</span>
                            <span className="mt-1 block text-xs font-normal leading-4 text-neutral-500">{section.detail}</span>
                        </button>
                    )
                })}
            </div>
        </nav>
    )
}
