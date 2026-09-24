// Actual chat components with loopback-only synthetic data. Keep interaction
// regressions alongside geometry coverage in both CI browser engines.
import { spawn } from "node:child_process"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const suites = [
    "run-fullscreen-comms-actions",
    "run-comms-action-edges",
    "run-fullscreen-comms-edges",
    "run-comms-final-actions",
    "run-comms-media-polish",
    "run-comms-portal-polish",
    "run-comms-popup-polish",
    "run-comms-safe-area",
]
for (const suite of suites) {
    console.log(`Comms interaction suite: ${suite}`)
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [`scripts/browser/${suite}.mjs`, ...engines], { stdio: "inherit" })
        child.once("error", reject)
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(Error(`${suite} failed (${signal ?? code})`)))
    })
}
