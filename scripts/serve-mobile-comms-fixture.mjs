// Loopback-only mobile chat fixture. Production shell CSS, viewport owner,
// message observer, composer and editor run against synthetic local content.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const directory = mkdtempSync(join(tmpdir(), "be-mobile-comms-"))
const sources = [
    "components/communications/ChatMotionViewport.tsx",
    "components/communications/ComposerFooter.tsx",
    "components/communications/ChatComposerInput.tsx",
    "components/communications/MessageComposer.tsx",
    "lib/workspace-composer-viewport.ts",
    "components/communications/composer-pointer-focus.ts",
    "components/communications/composer-touch.ts",
    "components/communications/message-pane-observer.ts",
    "lib/chat-formatting.ts",
    "lib/chat-viewport-motion.ts",
    "lib/mobile-conversation-motion.ts",
    "lib/mobile-conversation-easing.ts",
    "lib/mobile-conversation-viewport.ts",
    "lib/mobile-workspace-viewport.ts",
    "lib/communications/reading-visibility.ts",
    "lib/workspace-tab-activity.ts",
    "lib/workspace-tabs.ts",
]
const aliases = new Map(sources.map(path => ["@/" + path.replace(/\.(tsx?|js)$/, ""), "./" + path.split("/").at(-1).replace(/\.tsx?$/, ".js")]))
aliases.set("./ComposerMentionPicker", "./fixture-mention-picker.js")
aliases.set("./workspace-tabs.ts", "./workspace-tabs.js")
aliases.set("./chat-viewport-motion.ts", "./chat-viewport-motion.js")
aliases.set("./mobile-conversation-easing.ts", "./mobile-conversation-easing.js")
for (const path of sources) {
    let source = readFileSync(path, "utf8")
    for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
    const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: value => value, getNewLine: () => "\n" }))
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.tsx?$/, ".js")), result.outputText)
}
// Mentions are never offered by this synthetic chat. The actual input and its
// CodeMirror extensions still mount; the app-wide drawer is outside this test.
writeFileSync(join(directory, "fixture-mention-picker.js"), "export function ComposerMentionPicker(){return null}")
writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/mobile-comms-runner.mjs", "utf8"))
await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "runner.bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done()))
const bundle = readFileSync(join(directory, "runner.bundle.js"))
rmSync(directory, { recursive: true, force: true })
// Consume the exact production geometry rules. Fixture-only CSS supplies the
// surrounding layout/colours normally compiled by Tailwind; it never defines
// workspace top, panel height, viewport offset, or keyboard geometry formulas.
const appCss = readFileSync("app/globals.css", "utf8")
const geometryStart = appCss.indexOf('html[data-workspace-viewport-locked="true"] {')
const geometryEnd = appCss.indexOf("@keyframes betelgeze-loader", geometryStart)
if (geometryStart < 0 || geometryEnd < 0) throw Error("Production shell geometry CSS was not found")
const geometryCss = appCss.slice(geometryStart, geometryEnd)
const css = `*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px system-ui;background:#050505;color:#eee}html{font-size:16px}button{font:inherit}[hidden]{display:none!important}#shell{position:fixed;inset:0;overflow:hidden;background:#050505}[data-workspace-topbar],[data-workspace-tabbar],[data-workspace-tab-panels]{position:fixed;left:0;right:0}[data-workspace-topbar]{height:56px;background:#151515;z-index:4;padding:17px 14px}[data-workspace-tabbar]{height:44px;background:#202020;z-index:4;padding:11px 14px}[data-workspace-tab-panels]{overflow:hidden}#chat-host{height:100%;width:100%;display:flex;flex-direction:column}.chat{display:flex;flex-direction:column;height:100%;min-height:0;background:#0b0b0b}.chat-header{height:58px;flex:none;padding:18px 12px;border-bottom:1px solid #333;background:#141414}.chat [data-chat-motion-viewport]{min-height:0;flex:1;overflow:clip}.chat [data-chat-motion-layer]{display:flex;flex-direction:column;height:100%;min-height:0}.chat .pane-wrap{position:relative;flex:1;min-height:0}.chat [data-message-pane]{height:100%;overflow:auto;overscroll-behavior:contain}.messages{display:flex;flex-direction:column;justify-content:flex-end;min-height:100%;padding:12px;gap:8px}.message{padding:9px 12px;border-radius:12px;background:#252525;min-height:36px;flex:none}.message:last-child{background:#163a42}[data-composer-slot]{position:relative;z-index:2;flex:none;display:flex;flex-direction:column;justify-content:flex-end;overflow:clip}footer{flex:none;padding:12px;background:#101010;border-top:1px solid #333}.reply,.attachment{padding:8px;margin-bottom:8px;background:#252525;border-radius:8px}[data-workspace-mutation-scope="local"]{display:flex;align-items:center;gap:6px;border:1px solid #444;border-radius:15px;padding:6px;background:#000}[data-workspace-mutation-scope="local"] [data-chat-composer-host]{flex:1;min-width:0;padding:0 4px}[data-workspace-mutation-scope="local"] button{width:44px;height:44px;border:0;border-radius:50%;background:#fff;color:#000}footer>p{display:none}.cm-editor{width:100%}.cm-scroller{overflow:auto}#result{position:absolute;top:0;left:0;z-index:20;background:#050505;color:#aaa;max-height:1px;overflow:hidden}${geometryCss}`
const html = `<!doctype html><html data-workspace-viewport-locked="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-workspace-tabs-hosted="true"><div id="shell" data-workspace-shell-root><header data-workspace-topbar>Betelgeze</header><nav data-workspace-tabbar>Communications</nav><section data-workspace-tab-panels></section></div><pre id="result">Running</pre><script src="/runner.bundle.js"></script></body></html>`
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname
    if (request.method !== "GET" || !["/", "/runner.bundle.js"].includes(path)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'self'" })
    response.end(path === "/runner.bundle.js" ? bundle : html)
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
