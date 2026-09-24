// LAN-accessible local preview of actual Comms components; no account, server
// secrets, production API, or provider connections are included in this build.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, renameSync } from "node:fs"
import { tmpdir, networkInterfaces } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { DIAGNOSTIC_ROLES, DIAGNOSTIC_EVENTS, DIAGNOSTIC_LIMITS, sanitizeDiagnosticTrace } from "./browser/fullscreen-comms-diagnostic-schema.ts"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] }
const host = option("--host", "0.0.0.0")
const port = Number(option("--port", "3107"))
if (!host || !Number.isInteger(port) || port < 0 || port > 65535) throw Error("Use --host ADDRESS --port PORT")
const directory = mkdtempSync(join(tmpdir(), "be-fullscreen-comms-preview-"))
const io = resolve(root, "scripts/browser/fullscreen-comms-preview-io.tsx")
const aliases = {}
for (const name of ["CommunicationsRuntime", "useReliableCommunicationsRealtime", "useOfflineChat", "useAttachmentUploads"]) {
    aliases[`@/components/communications/${name}$`] = io
    aliases[`./${name}$`] = io
}
writeFileSync(join(directory, "image.mjs"), `import React from "react"; export default function Image({unoptimized,priority,fill,loader,quality,blurDataURL,placeholder,...props}){return React.createElement("img",props)}`)
writeFileSync(join(directory, "link.mjs"), `import React from "react"; export default function Link({prefetch,replace,scroll,...props}){return React.createElement("a",props)}`)
writeFileSync(join(directory, "navigation.mjs"), `const router={push(){},replace(){},refresh(){},back(){},forward(){},prefetch(){}}; export const useRouter=()=>router; export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);`)
writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))}); module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
// This fixture needs the simple local CSS module imported by shared UI. Keep
// its actual rules, scoped by source filename, without the Next runtime loader.
writeFileSync(join(directory, "css-module-loader.cjs"), `module.exports=function(source){const prefix="preview_"+require("node:crypto").createHash("sha1").update(this.resourcePath).digest("hex").slice(0,8)+"_"; const names={}; const css=source.replace(/\\.([a-zA-Z_][a-zA-Z0-9_-]*)/g,(_,name)=>"."+(names[name]??=prefix+name)); return "const style=document.createElement('style');style.textContent="+JSON.stringify(css)+";document.head.append(style);export default "+JSON.stringify(names)+";"}`)
Object.assign(aliases, { "next/image$": join(directory, "image.mjs"), "next/link$": join(directory, "link.mjs"), "next/navigation$": join(directory, "navigation.mjs") })
aliases["@"] = root
let bundle, css
try {
    const outputs = await Promise.all([
        new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: resolve(root, "scripts/browser/fullscreen-comms-preview.tsx"), output: { path: directory, filename: "preview.js" }, resolve: { alias: aliases, extensions: [".tsx", ".ts", ".mjs", ".js", ".json"], extensionAlias: { ".js": [".js", ".ts", ".tsx"] }, modules: [resolve(root, "node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.module\.css$/, use: join(directory, "css-module-loader.cjs") }] }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })], optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "preview.js"))))),
        postcss([tailwind({ base: root, optimize: false })]).process(readFileSync(resolve(root, "app/globals.css"), "utf8"), { from: resolve(root, "app/globals.css") }).then(result => result.css),
    ])
    ;[bundle, css] = outputs
} finally { rmSync(directory, { recursive: true, force: true }) }
if (process.argv.includes("--build-only")) { console.log(`Preview compiled: ${bundle.length} JS bytes; ${Buffer.byteLength(css)} CSS bytes. Server not started.`); process.exit(0) }
const fontRoutes = new Map()
let fontCss = ""
try {
    const styles = readdirSync(resolve(root, ".next/static/css")).filter(name => name.endsWith(".css"))
    const rules = styles.flatMap(name => readFileSync(resolve(root, ".next/static/css", name), "utf8").match(/@font-face\{[^}]+\}/g) ?? [])
    for (const rule of rules) {
        if (!/font-family:Geist(?: Mono)?;/.test(rule) || !rule.includes("unicode-range:u+00??")) continue
        const asset = rule.match(/url\(\/_next\/static\/media\/([a-zA-Z0-9.-]+\.woff2)\)/)?.[1]
        if (!asset || fontRoutes.has(`/preview-fonts/${asset}`)) continue
        fontRoutes.set(`/preview-fonts/${asset}`, ["font/woff2", readFileSync(resolve(root, ".next/static/media", asset))])
        fontCss += rule.replace(`/_next/static/media/${asset}`, `/preview-fonts/${asset}`)
    }
} catch { /* The fixture can still compile before the first local Next build. */ }
const html = `<!doctype html><html lang="en" class="antialiased" data-workspace-viewport-locked="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0a0a0a"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-192.png"><title>Comms · Local v7</title><link rel="stylesheet" href="/preview.css"><style>${fontCss}html,body,#preview-root{margin:0;min-height:100%;background:#0a0a0a}html{--font-geist-sans:Geist,Arial,Helvetica,sans-serif;--font-geist-mono:"Geist Mono",monospace}</style></head><body data-workspace-tabs-hosted="true" data-workspace-tab-active="true"><div id="preview-root"></div><script src="/preview.js"></script></body></html>`
const routes = new Map([
    ["/", ["text/html; charset=utf-8", html]],
    ["/preview.js", ["text/javascript; charset=utf-8", bundle]],
    ["/preview.css", ["text/css; charset=utf-8", css]],
    ["/manifest.webmanifest", ["application/manifest+json", JSON.stringify({ id: "/", name: "Comms local preview", short_name: "Comms preview", start_url: "/", display: "standalone", background_color: "#0a0a0a", theme_color: "#0a0a0a", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] })]],
    ["/brand/betelgeze-logo.svg", ["image/svg+xml", readFileSync(resolve(root, "public/brand/betelgeze-logo.svg"))]],
])
try { routes.set("/icons/icon-192.png", ["image/png", readFileSync(resolve(root, "public/icons/betelgeze-icon-192.png"))]) } catch { /* A missing optional install icon cannot prevent the preview. */ }
for (const [path, font] of fontRoutes) routes.set(path, font)
// Preview diagnostics accept a strict numeric/enum schema, never arbitrary
// payload content. One bounded local file is overwritten; no history accrues.
const layoutTracePath = "/private/tmp/mobile-comms-displacement/latest-phone-layout.json"
const traceNumbers = ["t", "vvPageTop", "vvOffsetTop", "vvHeight", "vvWidth", "vvScale", "innerHeight", "innerWidth", "scrollY", "htmlScrollTop", "bodyScrollTop", "htmlClientHeight", "bodyTop", "rootTop", "rootBottom", "rootLeft", "rootWidth", "rootHeight", "headerTop", "headerBottom", "headerHeight", "composerTop", "composerBottom", "composerHeight"]
const tracePositions = ["rootPosition", "bodyPosition", "headerPosition", "composerPosition"]
function sanitizeLayoutTrace(value) {
    if (value?.build !== "document-origin-v2" || value.coarsePointer !== true || value.touchCapable !== true || !Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 180) return null
    const samples = []
    for (const row of value.samples) {
        if (!row || typeof row !== "object") return null
        const sample = {}
        for (const key of traceNumbers) {
            if (typeof row[key] !== "number" || !Number.isFinite(row[key]) || Math.abs(row[key]) > 1e12) return null
            sample[key] = Math.round(row[key] * 100) / 100
        }
        for (const key of tracePositions) {
            if (!["static", "relative", "absolute", "fixed", "sticky", "missing"].includes(row[key])) return null
            sample[key] = row[key]
        }
        if (!["frame", "focusin", "focusout", "viewport-resize", "viewport-scroll", "window-resize", "window-scroll", "surface"].includes(row.cause)) return null
        if (!["entering", "open", "dismissing-keyboard", "leaving", "unknown"].includes(row.phase) || typeof row.focused !== "boolean") return null
        samples.push({ ...sample, cause: row.cause, phase: row.phase, focused: row.focused })
    }
    const range = key => [Math.min(...samples.map(row => row[key])), Math.max(...samples.map(row => row[key]))]
    return { build: "document-origin-v2", coarsePointer: true, touchCapable: true, summary: { samples: samples.length, durationMs: Math.round(samples.at(-1).t - samples[0].t), focusedSamples: samples.filter(row => row.focused).length, vvPageTop: range("vvPageTop"), vvOffsetTop: range("vvOffsetTop"), vvHeight: range("vvHeight"), rootTop: range("rootTop"), headerTop: range("headerTop"), composerBottom: range("composerBottom"), scrollY: range("scrollY") }, samples }
}
async function receiveLayoutTrace(request, response) {
    if (request.headers.origin !== `http://${request.headers.host}` || !String(request.headers["content-type"]).startsWith("application/json")) { response.writeHead(403); response.end(); return }
    const chunks = []
    let bytes = 0
    try {
        for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 256 * 1024) { response.writeHead(413); response.end(); return }
            chunks.push(chunk)
        }
        const trace = sanitizeLayoutTrace(JSON.parse(Buffer.concat(chunks).toString("utf8")))
        if (!trace) { response.writeHead(400); response.end(); return }
        mkdirSync(dirname(layoutTracePath), { recursive: true })
        writeFileSync(`${layoutTracePath}.tmp`, JSON.stringify(trace, null, 2), { mode: 0o600 })
        renameSync(`${layoutTracePath}.tmp`, layoutTracePath)
        response.writeHead(204, { "Cache-Control": "no-store" }); response.end()
    } catch { if (!response.headersSent) response.writeHead(400); response.end() }
}
async function receiveDiagnostic(request, response) {
    if (request.headers.origin !== `http://${request.headers.host}` || !String(request.headers["content-type"]).startsWith("application/json")) { response.writeHead(403); response.end(); return }
    const chunks = []
    let bytes = 0
    try {
        for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > DIAGNOSTIC_LIMITS.bytes) { response.writeHead(413); response.end(); return }
            chunks.push(chunk)
        }
        const trace = sanitizeDiagnosticTrace(JSON.parse(Buffer.concat(chunks).toString("utf8")))
        if (!trace) { response.writeHead(400); response.end(); return }
        const path = `/private/tmp/mobile-comms-displacement/latest-${trace.device === "touch" ? "phone" : "desktop"}-diagnostic.json`
        const sortedCosts = trace.frames.map(f => f.cost).sort((a, b) => a - b)
        const result = { receivedAt: new Date().toISOString(), roles: DIAGNOSTIC_ROLES, eventTypes: DIAGNOSTIC_EVENTS,
            summary: { frames: trace.frames.length, events: trace.events.length, styles: trace.styles.length, durationMs: trace.elapsed, samplingCostP95Ms: sortedCosts[Math.floor(sortedCosts.length * .95)], samplingCostMaxMs: sortedCosts.at(-1) }, ...trace }
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(`${path}.tmp`, JSON.stringify(result), { mode: 0o600 })
        renameSync(`${path}.tmp`, path)
        response.writeHead(204, { "Cache-Control": "no-store" }); response.end()
    } catch { if (!response.headersSent) response.writeHead(400); response.end() }
}
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://preview.local").pathname
    if (request.method === "POST" && path === "/__preview/layout-trace") { void receiveLayoutTrace(request, response); return }
    if (request.method === "POST" && path === "/__preview/diagnostic") { void receiveDiagnostic(request, response); return }
    const route = routes.get(path)
    if (request.method !== "GET" || !route) { response.writeHead(404); response.end("Local preview route not found"); return }
    response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'" })
    response.end(route[1])
})
server.on("error", error => { console.error(error.message); process.exitCode = 1 })
server.listen(port, host, () => {
    const actualPort = server.address().port
    console.log(`Local Comms preview: http://localhost:${actualPort}/`)
    if (host === "0.0.0.0") for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) if (entry.family === "IPv4" && !entry.internal) console.log(`Phone on the same network: http://${entry.address}:${actualPort}/`)
    console.log("Synthetic browser-local data only. No production connection. Keep this process running while testing.")
})
