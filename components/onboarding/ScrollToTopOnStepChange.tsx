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
            scrollArea.scrollTo({
                top: 0,
                behavior: "instant",
            })
            return
        }

        window.scrollTo({
            top: 0,
            behavior: "instant",
        })
    }, [stepKey])

    return null
}