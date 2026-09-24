// Loopback-only chat layout regression fixture. It mounts the production
// motion viewport, composer footer, CodeMirror editor and viewport owners.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const baseline = process.argv.includes("--baseline")
const directory = mkdtempSync(join(tmpdir(), "be-comms-layout-"))
const sources = [
    "components/communications/ChatMotionViewport.tsx",
    "components/communications/ComposerFooter.tsx",
    "components/communications/ChatComposerInput.tsx",
    "components/communications/composer-pointer-focus.ts",
    "components/communications/composer-touch.ts",
    "components/communications/message-pane-observer.ts",
    "lib/chat-formatting.ts",
    "lib/chat-viewport-motion.ts",
    "lib/mobile-conversation-motion.ts",
    "lib/mobile-conversation-easing.ts",
    ...(!baseline ? ["lib/mobile-conversation-viewport.ts"] : []),
    "lib/composer-viewport-controller.ts",
    "lib/viewport-origin-recovery.ts",
    "lib/workspace-visual-origin.ts",
    "lib/chat-viewport-state.ts",
    "lib/workspace-tabs.ts",
]
const aliases = new Map(sources.map(path => ["@/" + path.replace(/\.(tsx?|js)$/, ""), "./" + path.split("/").at(-1).replace(/\.tsx?$/, ".js")]))
aliases.set("./ComposerMentionPicker", "./fixture-mention-picker.js")
aliases.set("./workspace-tabs.ts", "./workspace-tabs.js")
aliases.set("./chat-viewport-motion.ts", "./chat-viewport-motion.js")
aliases.set("./mobile-conversation-easing.ts", "./mobile-conversation-easing.js")
for (const path of sources) {
    let source = baseline ? execFileSync("git", ["show", `1dc8f19b:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8")
    for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
    const result = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: value => value, getNewLine: () => "\n" }))
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.tsx?$/, ".js")), result.outputText)
}
// Mentions are never offered by this synthetic chat. The actual input and its
// CodeMirror extensions still mount; the app-wide drawer is outside this test.
writeFileSync(join(directory, "fixture-mention-picker.js"), "export function ComposerMentionPicker(){return null}")
writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/comms-layout-runner.mjs", "utf8").replaceAll("FIXTURE_BASELINE", String(baseline)))
await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "runner.bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done()))
const bundle = readFileSync(join(directory, "runner.bundle.js"))
rmSync(directory, { recursive: true, force: true })
const css = `*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px system-ui;background:#050505;color:#eee}button{font:inherit}#shell{position:fixed;inset:0;overflow:hidden;--bottom:100dvh;--origin:0px;--pan:0px;background:#050505}[data-workspace-topbar],[data-workspace-tabbar],[data-workspace-tab-panels]{transform:translateY(var(--pan))}[data-workspace-topbar]{position:absolute;left:0;right:0;top:var(--origin);height:56px;background:#151515;z-index:4;padding:17px 14px}[data-workspace-tabbar]{position:absolute;left:0;right:0;top:calc(56px + var(--origin));height:44px;background:#202020;z-index:4;padding:11px 14px}[data-workspace-tab-panels]{position:absolute;left:0;right:0;top:calc(100px + var(--origin));height:max(0px,calc(var(--bottom) - 100px));overflow:hidden}#chat-host,#chat-frame{height:100%;width:100%;border:0}#chat-host{display:flex;flex-direction:column}.chat{display:flex;flex-direction:column;height:100%;min-height:0;background:#0b0b0b}.chat-header{height:58px;flex:none;padding:18px 12px;border-bottom:1px solid #333;background:#141414}.chat [data-chat-motion-viewport]{min-height:0;flex:1;overflow:clip}.chat [data-chat-motion-layer]{display:flex;flex-direction:column;height:100%;min-height:0}.chat .pane-wrap{position:relative;flex:1;min-height:0}.chat [data-message-pane]{height:100%;overflow:auto;overscroll-behavior:contain}.messages{display:flex;flex-direction:column;justify-content:flex-end;min-height:100%;padding:12px;gap:8px}.message{padding:9px 12px;border-radius:12px;background:#252525;min-height:36px}.message:last-child{background:#163a42}[data-composer-slot]{position:relative;z-index:2;flex:none;display:flex;flex-direction:column;justify-content:flex-end;overflow:clip}footer{flex:none;padding:12px;background:#101010;border-top:1px solid #333}.reply,.attachment{padding:8px;margin-bottom:8px;background:#252525;border-radius:8px}.form{display:flex;align-items:center;gap:6px;border:1px solid #444;border-radius:15px;padding:5px;background:#000}.form [data-chat-composer-host]{flex:1;min-width:0;padding:0 4px}.form button{width:34px;height:34px;border:0;border-radius:50%;background:#fff;color:#000}.cm-editor{width:100%}.cm-scroller{overflow:auto}#result{position:absolute;top:0;left:0;z-index:20;background:#050505;color:#aaa;max-height:1px;overflow:hidden}`
const html = frame => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${css}</style></head><body>${frame ? '<div id="chat-host"></div>' : '<div id="shell"><header data-workspace-topbar>Betelgeze</header><nav data-workspace-tabbar>Communications</nav><main data-workspace-tab-panels></main></div><pre id="result">Running</pre>'}<script src="/runner.bundle.js"></script></body></html>`
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname
    if (request.method !== "GET" || !["/", "/frame", "/runner.bundle.js"].includes(path)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'self'" })
    response.end(path === "/runner.bundle.js" ? bundle : html(path === "/frame"))
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
