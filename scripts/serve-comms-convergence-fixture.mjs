// Production React fixture of the real unread owner and extracted Comms callbacks.
// All account, cursor, and network data are synthetic. Never opens production.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const baseline = process.env.COMMS_CONVERGENCE_BASELINE
const read = path => baseline ? execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8")
const directory = mkdtempSync(join(tmpdir(), "be-comms-convergence-"))
const sources = ["components/communications/useCommunicationsUnread.ts", "components/communications/useSharedUnreadSummary.ts", "lib/communications/read-state.ts", "lib/communications/unread-summary.ts", "lib/communications/unread-broadcast.ts", "lib/record-version.js"]
const aliases = new Map(sources.flatMap(path => {
    const file = path.split("/").at(-1), compiled = "./" + file.replace(/\.ts$/, ".js")
    return [["@/" + path.replace(/\.(ts|js)$/, ""), compiled], ["./" + file, compiled], ["./" + file.replace(/\.(ts|js)$/, ""), compiled]]
}))
aliases.set("../record-version.js", "./record-version.js")
aliases.set("@/lib/workspace-performance", "./stubs.js")
const compile = (source, fileName) => ts.transpileModule(source, { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
function callback(path, name) {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === "useCallback") found = node.initializer.arguments[0].getText(source)
        ts.forEachChild(node, visit)
    }
    visit(source)
    return found
}
const names = ["bootstrap", "onUnreadInvalidated", "updates", "record", "text", "stringValue", "realtimeMessage", "setReplyingTo", "setEditingMessage", "setActionMessageId", "setDraft", "setEditState", "setReadCursors", "editingSessionRef", "refresh", "synchronize", "NATIVE_TYPING_EVENT", "normalizeChatReadUpdate", "publishChatRead", "publishChatReads", "mergeCursor", "mergeChatReadCursors", "compareReadPositions", "knownReadCursors", "publishedReadSnapshot", "syncLifetime", "selectedRef", "knownMessageKeysRef", "messageAnimationKey", "invalidateUnreadSummary", "unreadMessageEventKey", "setSchemaReady", "setTeams", "setStickers", "setSelectedId", "flushPendingRead", "fetch", "workspaceId", "userId"]
try {
    for (const path of sources) {
        let source = read(path)
        for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
        writeFileSync(join(directory, path.split("/").at(-1).replace(/\.ts$/, ".js")), compile(source, path))
    }
    let extracted = ""
    for (const [kind, name, sync] of [["client", "CommunicationsWorkspace", "synchronize"], ["native", "TeamCommunicationsWorkspace", "refresh"]]) {
        const path = `components/communications/${name}.tsx`
        for (const [suffix, variable] of [["Realtime", "registerRealtime"], ["Snapshot", sync]]) {
            const source = callback(path, variable)
            if (!source) throw Error(`Missing current ${path} ${variable}`)
            extracted += `export function ${kind}${suffix}(dependencies) { const {${names.join(",")}} = dependencies; return (${source}); }\n`
        }
    }
    const panelInvalidator = callback("components/communications/CommunicationsPanel.tsx", "invalidateUnread")
    extracted += `export function panelInvalidator(dependencies, fallback) { const { workspaceId, userId, invalidateUnreadSummary } = dependencies; return ${panelInvalidator ? `(${panelInvalidator})` : "fallback"}; }\n`
    writeFileSync(join(directory, "callbacks.js"), compile(extracted, "callbacks.ts"))
    writeFileSync(join(directory, "stubs.js"), "export const beginWorkspaceInteraction=()=>({mark(){},finish(){}});")
    writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/comms-convergence-runner.mjs", "utf8"))
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#111;color:white;font:16px system-ui}main{padding:12px;max-width:900px;margin:auto}nav{display:flex;gap:8px;margin:12px 0}button,input{font:inherit;padding:10px}#pane{height:42vh;overflow:auto;border:1px solid #555}#pane p{height:35px;margin:0;padding:8px}input{box-sizing:border-box;width:100%;margin-top:10px}output{display:inline-block;min-width:40px}iframe{width:100%;height:90vh;border:0}</style></head><body data-workspace-tabs-hosted="true"><div id="root"></div><script src="/bundle.js"></script></body></html>`
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        if (request.method !== "GET" || !["/", "/bundle.js"].includes(path)) { response.writeHead(404); response.end(); return }
        response.writeHead(200, { "Content-Type": path === "/" ? "text/html" : "text/javascript", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
        response.end(path === "/" ? html : bundle)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
