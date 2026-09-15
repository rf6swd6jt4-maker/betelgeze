import assert from "node:assert/strict"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { appStartupBootstrap, appStartupStyles } from "../lib/app-startup.ts"

function boot(pathname: string, hostname = "app.betelgeze.com", frame = false) {
    const root = { dataset: {} as Record<string, string> }
    let update = () => {}, disconnected = 0
    let nodes: Array<{ closest: (selector: string) => unknown }> = []
    const top = {}, self = frame ? {} : top
    runInNewContext(appStartupBootstrap, {
        window: { location: { pathname, hostname }, self, top, addEventListener() {} },
        document: { documentElement: root, querySelectorAll: () => nodes },
        MutationObserver: class { constructor(callback: () => void) { update = callback } observe() {} disconnect() { disconnected++ } },
    })
    return { root, show(hidden = false) { nodes = [{ closest: () => hidden ? {} : null }]; update() }, get disconnected() { return disconnected } }
}
test("BE launch diamond is confined to the top-level app document", () => {
    assert.equal(boot("/fixture/queue").root.dataset.appStartup, "launch")
    assert.equal(boot("/fixture/queue?__betelgeze_tab=tab", "app.betelgeze.com", true).root.dataset.appStartup, "panel")
    assert.equal(boot("/fixture/queue", "app.betelgeze.com", true).root.dataset.appStartup, "panel", "even an unmarked frame must not show startup branding")
    assert.equal(boot("/login", "auth.betelgeze.com").root.dataset.appStartup, "none")
    assert.equal(boot("/", "betelgeze.com").root.dataset.appStartup, "none")
})
test("all public token surfaces suppress BE branding, including custom-domain rewrites", () => {
    const token = "a".repeat(64)
    for (const path of [`/client-portal/session/${token}`, `/onboarding/session/${token}`, `/onboarding/smsoptin`, `/${token}`]) {
        assert.equal(boot(path).root.dataset.appStartup, "client")
        assert.equal(boot(path, "client.example.com").root.dataset.appStartup, "client")
    }
})
test("hidden streamed content does not end launch; real content permanently retires the cover", () => {
    const f = boot("/fixture/queue")
    f.show(true)
    assert.equal(f.root.dataset.appStartup, "launch")
    f.show()
    assert.equal(f.root.dataset.appStartup, "complete")
    assert.equal(f.disconnected, 1, "startup observer stops once content is present")
    assert.match(appStartupStyles, /\[data-app-startup-screen\] \{ display: none !important/)
    assert.match(appStartupStyles, /html\[data-app-startup="launch"\] \[data-app-startup-screen\]/)
    assert.doesNotMatch(appStartupStyles, /html\[data-app-startup="(?:panel|client|complete)"\][^{]*\{[^}]*background-image/)
})
