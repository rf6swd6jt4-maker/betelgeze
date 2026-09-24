// Loopback-only actual conversation surface with synthetic document pan. This
// checks browser geometry and lifecycle, not a physical keyboard or read policy.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const directory = mkdtempSync(join(tmpdir(), "be-mobile-conversation-"))
const sources = [
    "components/communications/MobileConversationSurface.tsx",
    "components/communications/ChatMotionViewport.tsx",
    "components/communications/ComposerFooter.tsx",
    "components/communications/composer-touch.ts",
    "lib/mobile-conversation-viewport.ts",
    "lib/chat-viewport-motion.ts",
    "lib/mobile-conversation-motion.ts",
    "lib/mobile-conversation-easing.ts",
    "lib/workspace-tabs.ts",
]
const aliases = new Map(sources.map(path => ["@/" + path.replace(/\.(tsx?|js)$/, ""), "./" + path.split("/").at(-1).replace(/\.tsx?$/, ".js")]))
aliases.set("./workspace-tabs.ts", "./workspace-tabs.js")
aliases.set("./chat-viewport-motion.ts", "./chat-viewport-motion.js")
aliases.set("./mobile-conversation-easing.ts", "./mobile-conversation-easing.js")
for (const path of sources) {
    let source = readFileSync(path, "utf8")
    for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
    const result = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.tsx?$/, ".js")), result.outputText)
}
writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/mobile-conversation-runner.mjs", "utf8"))
let bundle, css
try {
    [bundle, css] = await Promise.all([
        new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js"))))),
        postcss([tailwind({ base: process.cwd(), optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css),
    ])
} finally { rmSync(directory, { recursive: true, force: true }) }
const fixtureCss = `html,body{margin:0;background:#000;color:#eee;font:14px system-ui}#fixture-shell{height:100vh}[data-workspace-topbar],[data-workspace-tabbar],[data-workspace-tab-panels]{position:fixed;left:0;width:100%}[data-workspace-topbar]{height:56px;z-index:55;background:#171717}[data-workspace-tabbar]{height:44px;z-index:40;background:#171717}[data-workspace-tab-panels]{overflow:hidden}.fixture-columns{display:grid;grid-template-columns:1fr;height:100%;overflow:hidden}.fixture-list{height:100%;min-height:0;overflow:auto;background:#151515}.fixture-row{height:48px;padding:12px;border-bottom:1px solid #333}.fixture-chat{display:flex;flex-direction:column;min-height:0;height:100%;background:#000}.fixture-chat>header{display:flex;flex:none;align-items:center;padding-inline:12px;background:#222}.fixture-chat [data-message-pane]{flex:1;min-height:0;overflow:auto}.fixture-message{padding:10px;margin:8px;background:#222}.fixture-chat footer{padding:12px;background:#222;min-height:80px}.fixture-chat textarea{height:50px;display:block;width:100%;font:16px system-ui;background:#000;color:#fff}.fixture-chat button{height:40px;min-width:40px}#result{position:fixed;left:0;top:0;height:1px;max-width:1px;overflow:hidden;pointer-events:none;z-index:-1}`
const html = `<!doctype html><html data-workspace-viewport-locked="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${fixtureCss}</style></head><body style="overflow:hidden"><div id="stage"></div><pre id="result">Running</pre><script src="/bundle.js"></script></body></html>`
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname
    if (request.method !== "GET" || !["/", "/bundle.js"].includes(path)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'" })
    response.end(path === "/bundle.js" ? bundle : html)
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
