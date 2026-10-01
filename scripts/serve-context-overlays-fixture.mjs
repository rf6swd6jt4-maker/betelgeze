// Actual context/dialog components with synthetic data; loopback only.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-context-overlays-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "actions.js"), 'export const connectClientAccount=async()=>({ok:true});export const refreshClientAccount=async()=>({ok:true});')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({push:()=>{},replace:()=>{},prefetch:()=>{}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    const baselineDialog = process.env.CONTEXT_DIALOG_BASELINE
    if (baselineDialog) writeFileSync(join(directory, "BaselineDialog.tsx"), execFileSync("git", ["show", `${baselineDialog}:components/ui/CenteredDialog.tsx`]))
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{ShellRelationshipContextPanel}from"@/components/workspace/ShellRelationshipContextPanel";
import{CenteredDialog}from"@/components/ui/CenteredDialog";
import{ClientConnectionsWorkspace}from"@/components/client-connections/ClientConnectionsWorkspace";
import{WorkspaceNavigationProvider}from"@/components/workspace/WorkspaceNavigation";
const context={id:"client-a",primary_person_name:"Alex Morgan",primary_email:"alex.long.address@example.test",primary_phone:"+353 123 4567",business_name:"Example Services",website_url:"example.test",industry_value:"construction",location_value:"Dublin",source_label:"Referral",primary_contact_role:"Owner",notes_summary:"Saved relationship notes",lifecycle_phase:"retention",metrics:[{label:"Open work",value:2}],manager:{id:"manager",name:"Pat Manager",avatarSrc:null},services:[{id:"service",name:"Appointment Setting",stage:"maintenance",assignee:{id:"staff",name:"Sam Staff",avatarSrc:null}}],allowedDestinations:["relationships","onboarding","fulfilment","client-connections"]};
const framed=window.parent!==window,connections=new URLSearchParams(location.search).has("connections");
const accounts=[{relationshipId:"client-a",clientName:"Alex",businessName:"A",connected:false},{relationshipId:"client-b",clientName:"Blair",businessName:"B",connected:false},{relationshipId:"client-c",clientName:"Casey",businessName:"C",connected:true,accountType:"client_account"}];
function Fixture(){const[mobile,setMobile]=useState(false),[modal,setModal]=useState(false),[active,setActive]=useState(true),[url,setUrl]=useState("/fixture/relationships/client-a"),[mounted,setMounted]=useState(true);
window.fixture={setActive,setMounted,setUrl,setModal};
const navigate=href=>{setMobile(false);setUrl(href);window.lastContextDestination=href};
const body=<div hidden={!active}><button id="modal-trigger" onClick={()=>setModal(true)}>Open centered dialog</button>{modal?<CenteredDialog title="Saved form" onClose={()=>setModal(false)}><input aria-label="Draft" defaultValue="Retained draft"/><button onClick={()=>setModal(false)}>Done</button></CenteredDialog>:null}</div>;
return <><button id="background" onClick={()=>{window.backgroundClicks=(window.backgroundClicks||0)+1}}>Background control</button><button id="context-trigger" onClick={event=>{event.currentTarget.focus({preventScroll:true});setMobile(true)}}>Show relationship context</button><output id="destination">{url}</output>{framed?body:<WorkspaceNavigationProvider value={{tabId:"native-a",workspaceSlug:"fixture",url,active,push:navigate,replace:navigate,refresh:()=>{},back:()=>{},forward:()=>{},prefetch:()=>{},context:()=>{}}}>{connections?<ClientConnectionsWorkspace workspaceSlug="fixture" accounts={accounts} agency={{connected:false,name:null,id:null}} canManageAgency={false}/>:body}</WorkspaceNavigationProvider>}{mounted?<ShellRelationshipContextPanel context={context} currentUrl={url} workspaceSlug="fixture" workspaceCapabilities={["relationships.view","onboarding.manage","fulfilment.manage","client_connections.manage"]} desktopOpen mobileOpen={mobile} onClose={()=>setMobile(false)} onNavigate={navigate}/>:null}</>}
createRoot(document.getElementById("root")).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })], entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { alias: { ...(baselineDialog ? { "@/components/ui/CenteredDialog$": join(directory, "BaselineDialog.tsx") } : {}), "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory,"link.js"), "@/app/[workspaceSlug]/client-connections/actions$": join(directory,"actions.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
