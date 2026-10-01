// Loopback-only fixture for the actual panel loading components and app CSS.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd()
const directory = mkdtempSync(join(tmpdir(), "be-panel-loading-"))

try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "navigation.js"), 'export const useWorkspaceNavigation=()=>null;export const useRouter=()=>({prefetch:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "entry.tsx"), `import React from "react";import{createRoot}from"react-dom/client";
import{PanelRouteLoading}from"@/components/workspace/PanelRouteLoading";
import{WorkspacePanelChrome}from"@/components/workspace/WorkspacePanelChrome";
import{WorkspaceBannerPending}from"@/components/admin/WorkspaceBannerPending";
import{WorkspaceTabOpeningState}from"@/components/workspace/WorkspaceTabOpeningState";
import{PanelTabHeader}from"@/components/panel/PanelTabHeader";
import{LibraryTabs}from"@/components/library/LibraryTabs";
import{QuickStats}from"@/components/panel/QuickStats";
import{FilterRail}from"@/components/panel/FilterRail";
import{List,ListItem,ListPrimaryRow,ListSecondaryRow}from"@/components/list/List";
const query=new URLSearchParams(location.search),variant=query.get("variant")||"work-items",stage=query.get("stage")||"route";
const urls={"work-items":"/fixture/work-items",assets:"/fixture/assets",notes:"/fixture/notes",sops:"/fixture/sops",communications:"/fixture/communications",settings:"/fixture/settings",admin:"/fixture/admin",detail:"/fixture/work-items/record-id",relationships:"/fixture/relationships",onboarding:"/fixture/onboarding",queue:"/fixture/queue"};
const title=variant==="detail"?"work item":undefined;
function Reference(){return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6"><div className="mx-auto max-w-7xl"><PanelTabHeader title={variant==="sops"?"SOPs":variant==="relationships"?"Relationships":variant==="onboarding"?"Onboarding":"Work Items"} description={variant==="sops"?"Team procedures and supporting files.":variant==="relationships"?"People, businesses and the services you deliver together.":variant==="onboarding"?"Relationship onboarding work, submitted information, and assigned delivery setup.":"Workspace tasks ordered by their most recent update."} actions={["relationships","work-items"].includes(variant)?<a href="#" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">{variant==="relationships"?"New relationship":"New work item"}</a>:undefined} tabs={["sops","work-items"].includes(variant)?<LibraryTabs workspaceSlug="fixture" active={variant==="sops"?"sops":"work-items"} limited={query.has("limited")}/>:undefined}/>{variant==="onboarding"?<QuickStats ariaLabel="Onboarding statistics for this page" items={[{label:"Active",value:2},{label:"Complete",value:1},{label:"Stuck",value:0}]}/>:null}{["relationships","onboarding"].includes(variant)?<><FilterRail ariaLabel="Synthetic filters"><span className="shrink-0 border-b border-white px-2 py-2 text-sm">All</span><span className="shrink-0 border-b border-transparent px-2 py-2 text-sm">Active</span></FilterRail><List ariaLabel="Synthetic records"><ListItem><ListPrimaryRow><span className="h-6">Synthetic record</span><span className="ml-auto">Open</span></ListPrimaryRow><ListSecondaryRow><span className="h-5">Synthetic detail</span></ListSecondaryRow></ListItem></List></>:null}</div></main>}
function Fixture(){return <><div data-fixture-shell className="relative h-24 border-b border-neutral-800 bg-neutral-950 text-white"><div className="h-14 border-b border-neutral-800 px-4 py-4">Synthetic workspace chrome</div><div className="h-10 px-4 py-2">Synthetic tab bar</div></div><div data-fixture-panel className="relative h-[calc(100dvh-6rem)] min-h-[calc(100dvh-6rem)] overflow-y-auto bg-neutral-950">{stage==="shell-opening"?<WorkspacePanelChrome pathname={urls[variant]||urls["work-items"]} banner={<WorkspaceBannerPending/>}><WorkspaceTabOpeningState url={urls[variant]||urls["work-items"]} workspaceSlug="fixture"/></WorkspacePanelChrome>:stage==="opening"?<WorkspaceTabOpeningState url={urls[variant]||urls["work-items"]} workspaceSlug="fixture"/>:stage==="reference"?<Reference/>:<PanelRouteLoading variant={variant} title={title}/>}</div></>}
createRoot(document.getElementById("root")).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { alias: { "next/link$": join(directory, "link.js"), "@/components/workspace/WorkspaceNavigation$": join(directory, "navigation.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally {
    rmSync(directory, { recursive: true, force: true })
}
