// Loopback-only fixture for actual native loading/read owners with synthetic data.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-native-loading-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({prefetch(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    const aliases = { "next/navigation$": join(directory, "navigation.js"), "@": root }
    for (const panel of ["Relationships", "Library", "Queue", "Work", "Admin"]) aliases[`./Native${panel}Panel$`] = resolve("scripts/fixtures/native-panel-loading-content.tsx")
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: resolve("scripts/fixtures/native-panel-loading.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { alias: aliases, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false }, plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) }), new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => { const path = new URL(request.url, "http://127.0.0.1").pathname; response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" }); response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html) })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
