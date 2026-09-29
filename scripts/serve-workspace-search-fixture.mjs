// Actual search lifecycle, hook, keyboard handler and result view against synthetic responses.
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
const directory = mkdtempSync(join(tmpdir(), "be-search-fixture-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    const shell = ts.createSourceFile("shell.tsx", readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const handlers = {}
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && ["submitSearch", "chooseSearchResult"].includes(node.name?.text)) handlers[node.name.text] = node.getText(shell)
        if (ts.isVariableDeclaration(node) && node.name.getText(shell) === "escape") handlers.escape = `const ${node.getText(shell)};`
        ts.forEachChild(node, visit)
    }
    visit(shell)
    if (!handlers.submitSearch || !handlers.chooseSearchResult || !handlers.escape) throw Error("Missing actual shell submitSearch handler")
    writeFileSync(join(directory, "keyboard.js"), ts.transpileModule(`export function searchHandlers(scope) { const { search, searchOpen, setSearchOpen, navigateSearchDestination, desktopSearchInputRef, mobileSearchTriggerRef } = scope; ${handlers.chooseSearchResult}; ${handlers.submitSearch}; ${handlers.escape}; return { submitSearch, chooseSearchResult, escape } }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
    // Bundle only the primitive consumed by this view; its implementation remains real.
    writeFileSync(join(directory, "ui.ts"), 'export { RoundPill } from "@/components/ui/RoundPill"')
    writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/workspace-search-runner.mjs"))
    const cssPromise = postcss([tailwind({ base: process.cwd(), optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" }, resolve: { alias: { "@/components/ui$": join(directory, "ui.ts"), "@": process.cwd() }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="stage" class="mx-auto max-w-2xl p-3"></div><pre id="result" class="whitespace-pre-wrap p-3 text-xs">Running…</pre><script src="/bundle.js"></script></body></html>'
    const routes = new Map([["/", ["text/html", html]], ["/bundle.js", ["text/javascript", bundle]], ["/style.css", ["text/css", css]]])
    const server = createServer((request, response) => {
        const route = routes.get(new URL(request.url, "http://127.0.0.1").pathname)
        if (request.method !== "GET" || !route) { response.writeHead(404); response.end(); return }
        response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
        response.end(route[1])
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
