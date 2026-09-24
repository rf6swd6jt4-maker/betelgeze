// Loopback-only geometry regression fixture; no account, messaging or network data.
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, extname, posix } from "node:path"
import ts from "typescript"

const modules = new Map()
function compile(path) {
    const route = "/" + path.replace(/\.tsx?$/, ".js")
    if (modules.has(route)) return route
    modules.set(route, "")
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    const code = compiled.replace(/(from\s*|import\s*)(["'])([^"']+)\2/g, (whole, prefix, quote, specifier) => {
        if (!specifier.startsWith(".") && !specifier.startsWith("@/")) throw Error(`Unsupported fixture dependency: ${specifier}`)
        let dependency = specifier.startsWith("@/") ? specifier.slice(2) : posix.normalize(posix.join(dirname(path), specifier))
        if (!extname(dependency)) dependency += ".ts"
        if (dependency.endsWith(".js")) dependency = dependency.slice(0, -3) + ".ts"
        return prefix + quote + compile(dependency) + quote
    })
    modules.set(route, code)
    return route
}
compile("lib/mobile-conversation-motion.ts")
compile("components/communications/message-pane-observer.ts")
compile("lib/communications/reading-visibility.ts")
compile("components/ui/anchored-popup-position.ts")
modules.set("/runner.js", readFileSync("scripts/browser/mobile-conversation-motion-runner.mjs", "utf8"))
const css = `
*{box-sizing:border-box}html,body{margin:0;background:#000;color:#eee;font:14px system-ui}
[hidden]{display:none!important}#stage{position:relative;width:390px;height:1100px;overflow:visible}
[data-mobile-conversation-surface]{position:absolute;top:0;left:0;display:flex;flex-direction:column;width:390px;height:844px;overflow:hidden;background:#000;isolation:isolate}
[data-native-chat-viewport]{display:flex;flex:1;min-height:0;flex-direction:column}
.fixture-header{height:56px;flex:none;background:#222;position:relative}
[data-chat-motion-viewport]{flex:1;min-height:0;overflow:clip}
[data-chat-motion-layer]{height:100%;min-height:0;display:flex;flex-direction:column;container-type:size}
.fixture-pane-wrapper{position:relative;flex:1;min-height:0}
[data-message-pane]{height:100%;overflow-x:hidden;overflow-y:auto;overflow-anchor:none;padding:20px 12px;overscroll-behavior:contain;touch-action:pan-y}
.fixture-stack{display:flex;min-height:100%;flex-direction:column;gap:8px}
.fixture-spacer{margin-top:auto}.fixture-message{height:40px;min-height:40px;background:#252525;border-radius:12px;padding:10px}
[data-composer-slot]{position:relative;flex-shrink:0;height:83px;display:flex;flex-direction:column;justify-content:flex-end;overflow:clip;background:#151515;z-index:10}
footer{height:100%;padding:12px}textarea{height:44px;width:100%;font-size:16px;background:#222;color:#fff;border:0}
#result{position:fixed;top:0;left:0;max-height:1px;max-width:1px;overflow:hidden;z-index:-1;pointer-events:none}`
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile conversation motion fixture</title><style>${css}</style></head><body data-workspace-tab-active="true"><div id="stage"></div><pre id="result">Running</pre><script type="module" src="/runner.js"></script></body></html>`
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname
    if (request.method !== "GET" || (path !== "/" && !modules.has(path))) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": path === "/" ? "text/html" : "text/javascript", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-src 'none'" })
    response.end(path === "/" ? html : modules.get(path))
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
