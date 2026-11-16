// The real client rail, Today side sections, client summary and client column inside a stand-in shell frame, with the
// real layout CSS and synthetic data. No database and no navigation: opened destinations go to window.fixtureOpened.
// ?staff hides the owner sections, ?many returns a truncated list, ?nodock makes Chat a link, ?offline disables rows.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-client-rail-"))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const me = id(9)
const item = (n, title, extra = {}) => ({ id: id(100 + n), title, status: "todo", relationship: extra.relationship ?? null, updated_at: new Date().toISOString(), created_at: new Date(Date.now() - n * 3_600_000).toISOString(), priority_band: 1, assessment: null, ...extra })
const names = [["Andy Sambitan", "Howdy Lighting"], ["Bruce Laing", "PRO Construction"], ["Élodie Marchand", null], ["Grace Whitlock", "Alder Legal"], ["Hannah Ortiz", "Northwind Dental"], ["Jason Hofer", "North Texas Shutters"], ["Leo Brandt", "Harbor & Pine"], ["Marek Dunne", "Atlas Logistics"], ["Ruth Marlow", "Marlow Estates"], ["Tariq", "Nine Elms Bakery"]]
const clients = names.map(([name, business], index) => ({ id: id(300 + index), name, business }))
const context = { id: id(301), primary_person_name: "Bruce Laing", primary_email: "bruce@pro-construction.example", primary_phone: "+1 555 0100", business_name: "PRO Construction", website_url: "pro-construction.example", industry_value: "construction", location_value: "austin", source_label: "Referral", primary_contact_role: "Owner", notes_summary: null, lifecycle_phase: "onboarding", metrics: [], allowedDestinations: ["relationships", "onboarding", "fulfilment", "client-connections"], manager: { id: id(40), name: "Sam Ortega", avatarSrc: null }, services: [{ id: id(60), name: "Paid social", stage: "onboarding", assignee: { id: id(41), name: "Priya Shah", avatarSrc: null } }] }
const team = { available: true, truncated: false, people: [
    { userId: id(40), name: "Sam Ortega", ready: 6, items: [item(11, "Refresh ad creatives", { status: "doing", relationship: "Cedar & Pine Interiors", calibrated_minutes: 120, due_at: new Date(Date.now() + 50 * 3_600_000).toISOString() }), item(12, "Kick-off deck", { relationship: "Northwind Dental", calibrated_minutes: 40 })] },
    { userId: id(41), name: "Priya Shah", ready: 3, items: [item(13, "Audience refresh", { relationship: "Harbor Fitness", calibrated_minutes: 30, due_at: new Date(Date.now() + 100 * 3_600_000).toISOString() }), item(11, "Refresh ad creatives", { status: "doing", shared: true, started_by: id(40), relationship: "Cedar & Pine Interiors" })] },
] }
const attention = { available: true, groups: [
    { kind: "waiting_on_reply", total: 1, items: [{ since: new Date(Date.now() - 2 * 86_400_000).toISOString(), relationshipId: id(30), client: "North Texas Shutters", title: "Client message waiting for a reply", recordId: id(30) }] },
    { kind: "disputed_task", total: 16, items: [{ since: new Date(Date.now() - 5 * 3_600_000).toISOString(), relationshipId: null, client: null, title: "Bug: application page failed", recordId: id(200) }, { since: new Date(Date.now() - 35 * 86_400_000).toISOString(), relationshipId: null, client: null, title: "Bug: application page failed", recordId: id(203) }, { since: new Date(Date.now() - 20 * 86_400_000).toISOString(), relationshipId: null, client: null, title: "Bug: application page failed", recordId: id(204) }, { since: null, relationshipId: id(31), client: "PRO Construction", title: "Calculate budget assumptions", recordId: id(201) }] },
    { kind: "overdue_task", total: 1, items: [{ since: null, relationshipId: null, client: null, title: "Familiarise yourself with Betelgeze", recordId: id(202) }] },
] }
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "entry.tsx"), `import React,{useEffect,useState}from"react";import{createRoot}from"react-dom/client";
import{ClientRail}from"@/components/workspace/ClientRail";import{TodaySide}from"@/components/workspace/TodaySide";import{ClientSummary}from"@/components/relationships/ClientSummary";
import{ShellRelationshipContextPanel}from"@/components/workspace/ShellRelationshipContextPanel";import{DetailPageHeader}from"@/components/detail/DetailPageHeader";import{RelationshipStage}from"@/components/ui/RelationshipStage";import{Button}from"@/components/ui/Button";
document.body.dataset.workspaceLayout="today";
const icon=d=><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d={d}/></svg>;
const context=${JSON.stringify(context)};
function Shell(){const params=new URLSearchParams(location.search);const staff=params.has("staff");const[path,setPath]=useState("/fixture/queue");const[pinned,setPinned]=useState(false);const[drawer,setDrawer]=useState(false);const[dock,setDock]=useState(null);const[revision,setRevision]=useState(0);
const phone=typeof window!=="undefined"&&window.matchMedia("(max-width: 767px)").matches;const open=phone?drawer:pinned;
useEffect(()=>{document.documentElement.style.setProperty("--workspace-sidebar-width",phone?"0px":pinned?"18rem":"5rem")},[pinned,phone]);
useEffect(()=>{if(dock)document.body.dataset.workspaceDock="shown";else delete document.body.dataset.workspaceDock},[dock]);
const go=href=>{(window.fixtureOpened??=[]).push(href);setPath(href);setDrawer(false)};
const client=path.startsWith("/fixture/relationships/")&&path!=="/fixture/relationships";const record=path.startsWith("/fixture/work-items/");
const dest=(key,label,primary,d)=>({key,label,href:"/fixture/"+key,primary,icon:icon(d),active:path==="/fixture/"+key});
const destinations=[dest("library","Library",true,"M4 5h5v15H4zM9 5h5v15H9z"),dest("staff","Staff",true,"M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7"),dest("settings","Settings",true,"M4 7h10M18 7h2M4 17h2M10 17h10"),dest("relationships","Relationships",false,"M8 9a3 3 0 1 0 0-6M16 9a3 3 0 1 0 0-6"),dest("onboarding","Onboarding",false,"M4 11l8-7 8 7v9H4z"),dest("client-connections","Client Connections",false,"M9 12h6M7 8H5a4 4 0 0 0 0 8h2M17 8h2a4 4 0 0 1 0 8h-2"),dest("admin","Admin",false,"M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z")].filter(item=>!staff||item.key==="library");
const today={key:"queue",label:"Today",href:"/fixture/queue",primary:true,active:path==="/fixture/queue",icon:<span className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-600 text-neutral-100">{icon("M5 7h14M5 12h14M5 17h9")}</span>};
return <>
<header data-workspace-topbar className="fixed inset-x-0 top-0 z-[55] flex h-14 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-6"><p className="text-sm font-semibold">Fixture</p><button type="button" data-fixture-pin aria-label="Toggle sidebar" aria-expanded={open} onClick={()=>phone?setDrawer(v=>!v):setPinned(v=>!v)} className="h-8 rounded border border-neutral-700 px-2 text-xs">Sidebar</button><button type="button" data-fixture-created onClick={()=>setRevision(v=>v+1)} className="h-8 rounded border border-neutral-700 px-2 text-xs">Created</button><span className="ml-auto"><Button variant="secondary" size="sm" data-comms-button aria-expanded={dock==="drawer"} onClick={()=>setDock(dock==="drawer"?null:"drawer")}>Comms</Button></span></header>
<div data-workspace-tab-panels className="fixed bottom-0 top-[6.25rem] z-30 overflow-y-auto bg-neutral-950">
{path==="/fixture/queue"?<div data-today-page className="@container mx-auto max-w-7xl px-4 pb-7 text-white sm:px-6"><div className={staff?undefined:"grid gap-x-8 gap-y-6 @4xl:grid-cols-[minmax(0,1fr)_21rem]"}><div className="min-w-0"><h1 className="pt-6 text-2xl font-semibold">Today</h1><p data-fixture-queue className="mt-4 rounded-2xl border border-card-border bg-[var(--color-surface-1)] p-6 text-sm text-neutral-400">The person's full queue renders here (PersonalWorkQueue, unchanged).</p></div>{staff?null:<div className="min-w-0 @4xl:pt-6"><TodaySide workspaceSlug="fixture" userId="${me}" onOpen={go}/></div>}</div></div>
:client?<main className="min-h-full px-4 py-6 sm:px-6"><div className="mx-auto max-w-[92rem]"><DetailPageHeader category="Relationship" reference="69e381e" title={context.primary_person_name} subtitle={context.business_name} labels={<RelationshipStage phase="onboarding"/>} updated="5hr"/><ClientSummary context={context} workspaceSlug="fixture" onChat={params.has("nodock")?undefined:()=>setDock("column")}/><p className="mt-6 text-sm text-neutral-500">Editable details, services, engagement and attachments follow (unchanged).</p></div></main>
:<div className="p-6"><p data-fixture-work-area>Work area: {path}</p></div>}
</div>
{record?<ShellRelationshipContextPanel desktopOpen={!dock} mobileOpen={false} onClose={()=>{}} dense onChat={()=>setDock("column")} context={context} workspaceSlug="fixture" currentUrl={path} onNavigate={go} workspaceCapabilities={["relationships.view","onboarding.manage"]}/>:null}
{dock?<aside data-workspace-docked-chat={dock} aria-label="Comms" className="fixed bottom-0 right-0 top-14 z-[35] hidden w-[var(--workspace-dock-width)] flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950 text-white lg:flex"><header className="shrink-0 border-b border-neutral-800 px-4 py-2"><div className="flex min-h-9 items-center gap-2"><h2 className="min-w-0 flex-1 truncate text-base font-semibold">{dock==="drawer"?"Comms":context.business_name}</h2><button data-icon-button type="button" onClick={()=>setDock(null)} aria-label="Close Comms" className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-xl text-neutral-400 hover:text-white">×</button></div></header><p className="p-4 text-sm text-neutral-500">The Communications page loads here.</p></aside>:null}
{phone&&drawer?<button data-workspace-sidebar-dismiss type="button" aria-label="Close sidebar" onClick={()=>setDrawer(false)} className="fixed inset-x-0 bottom-0 top-14 z-[45] cursor-default md:hidden"/>:null}
<aside data-workspace-sidebar data-client-rail="" data-collapsed={!phone&&!pinned?"true":"false"} aria-hidden={phone&&!drawer} className={"fixed left-2 top-16 z-50 h-[calc(100dvh-4.5rem)] w-[17rem] overflow-hidden rounded-2xl border border-card-border bg-[var(--color-surface-glass)] shadow-card backdrop-blur-xl backdrop-saturate-150 "+(open?"":"md:w-16 ")+(open?"translate-x-0":"max-md:invisible max-md:-translate-x-[calc(100%+1rem)]")}>
<nav className="flex h-full touch-pan-y flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-5 md:gap-1 md:overflow-visible md:overscroll-auto md:px-2 md:py-4">
<ClientRail workspaceSlug="fixture" userId="${me}" activePath={path} online={!params.has("offline")} today={today} destinations={destinations} refreshKey={revision} onOpenClient={go} onOpenDestination={(item,event)=>{event.preventDefault();go(item.href)}}/>
</nav></aside></>}
createRoot(document.getElementById("root")).render(<Shell/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"),
            "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const counts = { rail: 0, attention: 0, team: 0 }
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        const ok = request.headers["x-workspace-user"] === me
        if (path === "/api/workspaces/fixture/client-rail") { counts.rail++; const many = (request.headers.referer ?? "").includes("many"); response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(many ? { allowed: true, truncated: true, clients: Array.from({ length: 60 }, (_, index) => ({ id: id(400 + index), name: `Client ${String(index + 1).padStart(2, "0")} Person`, business: index % 3 ? `Company ${index + 1}` : null })) } : { allowed: true, truncated: false, clients })), 200); return }
        if (path === "/api/workspaces/fixture/needs-attention") { counts.attention++; response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(attention)), 200); return }
        if (path === "/api/workspaces/fixture/team-queue") { counts.team++; response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json" }); setTimeout(() => response.end(JSON.stringify(team)), 200); return }
        if (path === "/fixture-counts") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(counts)); return }
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html)
    })
    server.listen(Number(process.env.PORT ?? 3109), "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
