// Matched production-mode component bundles. Synthetic local data only; this
// does not establish authenticated application or physical-device latency.
import { createServer } from "node:http"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { gzipSync } from "node:zlib"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const baseline = process.env.COMMS_REFERENCE_BASELINE
const directory = mkdtempSync(join(tmpdir(), "be-reference-performance-"))
try {
    const replacements = {}
    if (baseline) for (const path of ["components/communications/ChatComposerInput.tsx", "components/communications/ChatMessageText.tsx", "components/communications/ComposerMentionPicker.tsx", "components/communications/MessageComposer.tsx", "lib/chat-formatting.ts"]) {
        replacements[resolve(path)] = execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" })
    }
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});const replacements=${JSON.stringify(replacements)};module.exports=function(source){return ts.transpileModule(replacements[this.resourcePath]??source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "ui.ts"), 'export { Assignee } from "@/components/ui/Assignee"; export { SelectorDrawer, SelectorOption } from "@/components/ui/Selector"')
    writeFileSync(join(directory, "baseline-references.js"), 'export function MessageReferences({children}) { return children }')
    writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/comms-reference-performance-runner.mjs"))
    const bundle = await new Promise((done, fail) => webpack({
        mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "@/components/ui$": join(directory, "ui.ts"), ...(baseline ? { "@/components/communications/MessageReferences$": join(directory, "baseline-references.js") } : {}), "@": process.cwd() }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] },
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }), "FIXTURE_BASELINE": JSON.stringify(baseline ?? null) })],
        optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = '*{box-sizing:border-box}html,body{margin:0;height:100%;font:16px system-ui;background:#0a0a0a;color:white}#stage{height:100dvh;display:flex;flex-direction:column;padding:12px;overflow:hidden}.history{flex:1;overflow:auto;min-height:0}.row{padding:8px;margin-bottom:8px;background:#222;border-radius:8px}.composer{flex:none;display:flex;padding:8px;border:1px solid #444;border-radius:12px}.cm-editor{width:100%}#result{position:fixed;pointer-events:none;height:1px;overflow:hidden}a{color:inherit}svg{width:14px;height:14px}'
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="stage"></div><pre id="result">Running</pre><script src="/bundle.js"></script></body></html>`
    const stats = JSON.stringify({ baseline: baseline ?? null, jsBytes: bundle.length, gzipBytes: gzipSync(bundle).length })
    const routes = new Map([["/", ["text/html", html]], ["/bundle.js", ["text/javascript", bundle]], ["/stats", ["application/json", stats]]])
    const server = createServer((request, response) => {
        const route = routes.get(new URL(request.url, "http://127.0.0.1").pathname)
        if (request.method !== "GET" || !route) { response.writeHead(404); response.end(); return }
        response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
        response.end(route[1])
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
