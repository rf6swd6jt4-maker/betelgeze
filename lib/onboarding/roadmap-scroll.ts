/** Keep the active step visible without scrolling any ancestor of the roadmap. */
export function scrollOnboardingRoadmap(container: HTMLElement, step: HTMLElement) {
    if (container.clientHeight === 0) return

    const containerRect = container.getBoundingClientRect()
    const stepRect = step.getBoundingClientRect()
    const top = containerRect.top + container.clientTop
    const bottom = top + container.clientHeight
    if (stepRect.top >= top && stepRect.bottom <= bottom) return

    container.scrollTo({
        top: Math.max(0, Math.min(
            container.scrollHeight - container.clientHeight,
            container.scrollTop + stepRect.top - top - (container.clientHeight - stepRect.height) / 2,
        )),
        behavior: "instant",
    })
}
