// Actual composer, popup and reference components with synthetic responses.
// No production account, record, provider or message I/O.
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
const directory = mkdtempSync(join(tmpdir(), "be-comms-references-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "ui.ts"), 'export { Assignee } from "@/components/ui/Assignee"; export { SelectorDrawer, SelectorOption } from "@/components/ui/Selector"')
    const nativeHost = ts.createSourceFile("host.tsx", readFileSync("components/workspace/NativeCommunicationsTab.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let capture
    function visit(node) {
        if (ts.isJsxAttribute(node) && node.name.getText(nativeHost) === "onClickCapture" && ts.isJsxExpression(node.initializer)) capture = node.initializer.expression.getText(nativeHost)
        ts.forEachChild(node, visit)
    }
    visit(nativeHost)
    if (!capture) throw Error("Native Communications navigation capture not found")
    writeFileSync(join(directory, "navigation-handler.js"), ts.transpileModule(`export function nativeCapture({active, navigation, workspaceSlug}) { const blocked=false; return ${capture} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
    writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/comms-references-runner.mjs"))
    const cssPromise = postcss([tailwind({ base: process.cwd(), optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({
        mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "@/components/ui$": join(directory, "ui.ts"), "@": process.cwd() }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] },
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })], optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="stage" style="position:fixed;inset:0;display:flex;flex-direction:column;padding:12px;overflow:hidden"></div><pre id="result" style="position:fixed;pointer-events:none;height:1px;overflow:hidden">Running</pre><script src="/bundle.js"></script></body></html>'
    const routes = new Map([["/", ["text/html", html]], ["/bundle.js", ["text/javascript", bundle]], ["/style.css", ["text/css", css]]])
    const server = createServer((request, response) => {
        const route = routes.get(new URL(request.url, "http://127.0.0.1").pathname)
        if (request.method !== "GET" || !route) { response.writeHead(404); response.end(); return }
        response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:" })
        response.end(route[1])
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
