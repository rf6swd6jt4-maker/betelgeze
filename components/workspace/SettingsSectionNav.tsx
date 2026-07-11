"use client"

import { useEffect, useRef, useState } from "react"

export type SettingsSectionNavItem = {
    id: string
    label: string
    detail: string
}

export function SettingsSectionNav({ sections }: { sections: SettingsSectionNavItem[] }) {
    const [active, setActive] = useState(sections[0]?.id ?? "")
    const activeRef = useRef(active)

    useEffect(() => {
        const nodes = sections
            .map((section) => document.getElementById(section.id))
            .filter((node): node is HTMLElement => Boolean(node))
        if (!nodes.length) return

        let frame = 0
        let previousScrollY = window.scrollY

        function updateActiveSection() {
            frame = 0
            const scrollY = window.scrollY
            const direction = scrollY >= previousScrollY ? 1 : -1
            previousScrollY = scrollY
            const activationLine = window.innerHeight * 0.22
            const hysteresis = 28
            const currentIndex = Math.max(0, nodes.findIndex((node) => node.id === activeRef.current))
            let nextIndex = currentIndex

            if (window.innerHeight + scrollY >= document.documentElement.scrollHeight - 2) {
                nextIndex = nodes.length - 1
            } else if (direction > 0) {
                while (nextIndex < nodes.length - 1 && nodes[nextIndex + 1].getBoundingClientRect().top <= activationLine - hysteresis) {
                    nextIndex += 1
                }
            } else {
                while (nextIndex > 0 && nodes[nextIndex].getBoundingClientRect().top > activationLine + hysteresis) {
                    nextIndex -= 1
                }
            }

            const nextActive = nodes[nextIndex]?.id
            if (nextActive && nextActive !== activeRef.current) {
                activeRef.current = nextActive
                setActive(nextActive)
            }
        }

        function scheduleUpdate() {
            if (frame) return
            frame = window.requestAnimationFrame(updateActiveSection)
        }

        scheduleUpdate()
        window.addEventListener("scroll", scheduleUpdate, { passive: true })
        window.addEventListener("resize", scheduleUpdate)
        return () => {
            if (frame) window.cancelAnimationFrame(frame)
            window.removeEventListener("scroll", scheduleUpdate)
            window.removeEventListener("resize", scheduleUpdate)
        }
    }, [sections])

    function scrollToSection(id: string) {
        activeRef.current = id
        setActive(id)
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    const activeIndex = Math.max(0, sections.findIndex((section) => section.id === active))

    return (
        <nav className="sticky top-5 hidden self-start lg:block">
            <div className="relative space-y-2 pl-5">
                <span
                    aria-hidden="true"
                    className="absolute left-0 top-2 h-8 w-1 rounded-full bg-white transition-transform duration-200 ease-out will-change-transform"
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
