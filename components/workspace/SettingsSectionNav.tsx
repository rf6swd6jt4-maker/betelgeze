"use client"

import { useEffect, useRef, useState } from "react"
import { resolveSettingsSectionIndex } from "@/lib/settings-section-navigation"

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

        function updateActiveSection() {
            frame = 0
            const scrollingElement = document.scrollingElement
            const scrollTop = scrollingElement?.scrollTop ?? window.scrollY
            const viewportHeight = scrollingElement?.clientHeight || window.innerHeight
            const scrollHeight = scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight
            const activationLine = window.innerHeight * 0.22
            const currentIndex = Math.max(0, nodes.findIndex((node) => node.id === activeRef.current))
            const nextIndex = resolveSettingsSectionIndex({
                tops: nodes.map((node) => node.getBoundingClientRect().top),
                currentIndex,
                activationLine,
                atEnd: viewportHeight + scrollTop >= scrollHeight - 2,
            })

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

        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate)
        nodes.forEach((node) => resizeObserver?.observe(node))
        scheduleUpdate()
        window.addEventListener("scroll", scheduleUpdate, { passive: true })
        window.addEventListener("resize", scheduleUpdate)
        document.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true })
        return () => {
            if (frame) window.cancelAnimationFrame(frame)
            resizeObserver?.disconnect()
            window.removeEventListener("scroll", scheduleUpdate)
            window.removeEventListener("resize", scheduleUpdate)
            document.removeEventListener("scroll", scheduleUpdate, true)
        }
    }, [sections])

    function scrollToSection(id: string) {
        const node = document.getElementById(id)
        // Keep the geometry and selected state atomic. In embedded Safari,
        // smooth scrolling begins after the next scheduled geometry frame,
        // which can restore the old section before the scroll surface moves.
        node?.scrollIntoView({ behavior: "auto", block: "start" })
        activeRef.current = id
        setActive(id)
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
