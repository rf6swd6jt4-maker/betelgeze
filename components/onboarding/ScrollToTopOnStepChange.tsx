"use client"

import { useEffect } from "react"

type ScrollToTopOnStepChangeProps = {
    stepKey: string
}

export function ScrollToTopOnStepChange({
    stepKey,
}: ScrollToTopOnStepChangeProps) {
    useEffect(() => {
        const scrollArea = document.getElementById("onboarding-scroll-area")

        if (scrollArea) {
            scrollArea.scrollTo({ top: 0, behavior: "instant" })
        }

        window.scrollTo({ top: 0, behavior: "instant" })
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
    }, [stepKey])

    return null
}