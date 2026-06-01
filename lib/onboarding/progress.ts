export type ProgressStep = {
    key: string
}

export function getCompletedStepCount(
    steps: ProgressStep[],
    completedStepKeys: Iterable<string>
) {
    const completedKeys = new Set(completedStepKeys)

    return steps.filter((step) => completedKeys.has(step.key)).length
}

export function getProgressPercentage(
    steps: ProgressStep[],
    completedStepKeys: Iterable<string>
) {
    if (steps.length === 0) {
        return 100
    }

    return Math.round(
        (getCompletedStepCount(steps, completedStepKeys) / steps.length) * 100
    )
}
