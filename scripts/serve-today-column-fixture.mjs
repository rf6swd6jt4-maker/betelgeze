// The real Today column inside a stand-in shell frame, with the real layout CSS and record cache and synthetic data.
// No database and no navigation: opened destinations are recorded in window.fixtureOpened.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-today-column-"))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const me = id(9), ws = id(1)
const item = (n, title, extra = {}) => ({ id: id(100 + n), title, status: "todo", relationship: extra.relationship ?? null, updated_at: new Date().toISOString(), created_at: new Date(Date.now() - n * 3_600_000).toISOString(), priority_band: 1, assessment: null, ...extra })
const queue = {
    kind: "queue", userId: me, workspaceId: ws, workspaceSlug: "fixture", view: "ready", ready: 4, deferred: 1, total: 5,
    items: [
        item(1, "Monthly performance report", { status: "doing", relationship: "Harbor Fitness", calibrated_minutes: 45, due_at: new Date(Date.now() + 3 * 3_600_000).toISOString() }),
        item(2, "Launch spring offer campaign with the approved creatives and budget", { relationship: "Lumen Physio", calibrated_minutes: 60, due_at: new Date(Date.now() + 26 * 3_600_000).toISOString() }),
        item(3, "Kick-off call notes", { relationship: "Northwind Dental", calibrated_minutes: 20 }),
        item(4, "Refresh ad creatives", { relationship: "Cedar & Pine Interiors", blocked: true, calibrated_minutes: 150, due_at: new Date(Date.now() - 50 * 3_600_000).toISOString() }),
    ],
}
const team = { available: true, truncated: false, people: [
    { userId: id(40), name: "Sam Ortega", ready: 6, items: [item(11, "Refresh ad creatives", { status: "doing", relationship: "Cedar & Pine Interiors", calibrated_minutes: 120, due_at: new Date(Date.now() + 50 * 3_600_000).toISOString() }), item(12, "Kick-off deck", { relationship: "Northwind Dental", calibrated_minutes: 40 })] },
    { userId: id(41), name: "Priya Shah", ready: 3, items: [item(13, "Audience refresh", { relationship: "Harbor Fitness", calibrated_minutes: 30, due_at: new Date(Date.now() + 100 * 3_600_000).toISOString() }), item(11, "Refresh ad creatives", { status: "doing", shared: true, started_by: id(40), relationship: "Cedar & Pine Interiors" })] },
] }
const attention = { available: true, groups: [
    { kind: "waiting_on_reply", total: 1, items: [{ since: new Date(Date.now() - 2 * 86_400_000).toISOString(), relationshipId: id(30), client: "North Texas Shutters", title: "Client message waiting for a reply", recordId: id(30) }] },
    { kind: "disputed_task", total: 16, items: [{ since: new Date(Date.now() - 5 * 3_600_000).toISOString(), relationshipId: null, client: null, title: "Bug: application page failed", recordId: id(200) }, { since: null, relationshipId: id(31), client: "PRO Construction", title: "Calculate budget assumptions", recordId: id(201) }] },
    { kind: "overdue_task", total: 1, items: [{ since: null, relationshipId: null, client: null, title: "Familiarise yourself with Betelgeze", recordId: id(202) }] },
] }
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "native-tab.js"), `export const nativePanelCacheKey=(u,w,k)=>u+":"+w+":"+k;
export async function readNativePanel({url,workspaceSlug,userId,signal}){const r=await fetch("/api/workspaces/"+workspaceSlug+"/panels/queue",{headers:{"x-workspace-user":userId},signal});if(!r.ok)throw Error("Could not load this panel. Please retry.");(window.fixtureQueueReads??=[]).push(url);return r.json()}`)
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{TodayColumn,useTodayColumnVisible}from"@/components/workspace/TodayColumn";import{WorkspaceRecordCache}from"@/lib/workspace-record-cache";import{SideDrawer}from"@/components/ui/SideDrawer";
const cache=new WorkspaceRecordCache();
document.body.dataset.workspaceLayout="today";document.documentElement.style.setProperty("--workspace-sidebar-width","5rem");
function Shell(){const[url,setUrl]=useState("/fixture/queue");const[sheet,setSheet]=useState(false);const visible=useTodayColumnVisible(true);const staff=new URLSearchParams(location.search).has("staff");const recent=[{id:"r1",title:"Harbor Fitness",url:"/fixture/relationships/harbor"},{id:"r2",title:"Staff",url:"/fixture/staff"},{id:"r3",title:"Queue",url:"/fixture/queue"}];return <>
<header className="fixed inset-x-0 top-0 z-40 h-14 border-b border-neutral-800 bg-neutral-950" />
<div data-workspace-tabbar className="fixed top-14 z-40 flex h-11 items-center border-b border-neutral-800 bg-neutral-950 px-2"><button type="button" data-today-button aria-expanded={sheet} onClick={()=>setSheet(true)} className="mb-1 inline-flex h-9 shrink-0 items-center rounded-lg border border-neutral-700 px-3 text-sm font-medium lg:hidden">Today</button><div className="relative h-full min-w-0 flex-1"><p data-today-destination className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-2 px-1 pb-1 text-sm font-medium text-neutral-200 lg:px-2"><span className="truncate">{url}</span></p><div role="tablist" aria-label="Workspace tabs" className="bg-red-900 text-xs">TABS (hidden in Today layout)</div></div><button type="button" aria-label="Show relationship context" className="h-8 w-8 rounded bg-neutral-800">C</button></div>
{sheet&&!visible?<SideDrawer side="left" label="Today" onClose={()=>setSheet(false)}>{dismiss=><><div className="flex shrink-0 items-center justify-between border-b border-card-border px-4 py-2"><h2 className="text-base font-semibold">Today</h2><button type="button" onClick={dismiss} aria-label="Close Today" className="h-11 w-11">×</button></div><div className="min-h-0 flex-1">
<TodayColumn workspaceSlug="fixture" workspaceId="${ws}" userId="${me}" canSeeAttention={!staff} cache={cache} activeUrl={url} recent={recent} onOpen={(href)=>{dismiss();(window.fixtureOpened??=[]).push(href);setUrl(href)}}/></div></>}</SideDrawer>:null}
{visible?<div data-workspace-today-shell className="fixed bottom-0 top-14 z-30 hidden border-r border-neutral-800 bg-neutral-950 lg:block">
<TodayColumn workspaceSlug="fixture" workspaceId="${ws}" userId="${me}" canSeeAttention={!staff} cache={cache} activeUrl={url} recent={recent} onOpen={(href)=>{(window.fixtureOpened??=[]).push(href);setUrl(href)}}/></div>:null}
<div data-workspace-tab-panels className="fixed bottom-0 top-[6.25rem] z-30 overflow-hidden bg-neutral-950 p-6"><p data-fixture-work-area>Work area: {url}</p></div></>}
createRoot(document.getElementById("root")).render(<Shell/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"),
            "@/components/workspace/NativeWorkspaceTab$": join(directory, "native-tab.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const counts = { queue: 0, attention: 0, team: 0 }
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        const ok = request.headers["x-workspace-user"] === me
        if (path === "/api/workspaces/fixture/panels/queue") { counts.queue++; response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(queue)), 200); return }
        if (path === "/api/workspaces/fixture/needs-attention") { counts.attention++; response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(attention)), 200); return }
        if (path === "/api/workspaces/fixture/team-queue") { counts.team++; response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(team)), 200); return }
        if (path === "/fixture-counts") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(counts)); return }
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html)
    })
    server.listen(Number(process.env.PORT ?? 3109), "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
