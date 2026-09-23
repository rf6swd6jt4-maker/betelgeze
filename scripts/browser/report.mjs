export function assertFixtureReport(report, expected) {
    if (!Number.isSafeInteger(expected) || expected < 1 || !report || report.total !== expected || !Array.isArray(report.cases) || report.cases.length !== expected || report.passed !== expected || report.cases.some(row => row.passed !== true) || report.missing?.length || report.missingPaintSamples) {
        throw Error(`Incomplete or failed browser fixture: expected ${expected} cases; received ${JSON.stringify(report)}`)
    }
}
