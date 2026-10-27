// Actual settings/admin popup owners with synthetic local data and no writes.
import { createServer } from "node:http"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire, stripTypeScriptTypes } from "node:module"
const { ghlPopupResponse } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(readFileSync("lib/ghl-oauth/popup-response.ts", "utf8"))).toString("base64"))
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const strict = process.env.SERVICE_TRANSFER_STRICT === "1"
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-client-connections-"))
try {
    // Optional read-only baseline for matched performance observations; never checks out or edits source.
    const baseline = process.env.BE_CALENDAR_FIXTURE_BASE
    const calendarAlias = {}
    if (baseline) {
        if (!/^[a-f0-9]{7,40}$/i.test(baseline)) throw new Error("Fixture baseline must be a Git commit SHA")
        const source = execFileSync("git", ["show", `${baseline}:components/client-portal/ClientPortalCalendar.tsx`], { encoding: "utf8" })
        const path = join(directory, "BaselineClientPortalCalendar.tsx")
        writeFileSync(path, source.replaceAll('from "./', 'from "@/components/client-portal/').replaceAll('import("./', 'import("@/components/client-portal/'))
        calendarAlias["@/components/client-portal/ClientPortalCalendar$"] = path
    }
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    // Preserve CSS-module isolation: raw `.grid` must never overwrite shared Tailwind grids.
    writeFileSync(join(directory, "css.cjs"), String.raw`const postcss=require(${JSON.stringify(require.resolve("postcss"))});const{createHash}=require("node:crypto");module.exports=function(source){const names={};const root=postcss.parse(source);if(this.resourcePath.endsWith(".module.css")){const prefix="fixture_"+createHash("sha256").update(this.resourcePath).digest("hex").slice(0,10)+"_";root.walkRules(rule=>{if(/:global|:local/.test(rule.selector))throw Error("Unsupported explicit CSS module scope in fixture");rule.selector=rule.selector.replace(/\.([a-zA-Z][\w-]*)/g,(_,name)=>"."+(names[name]??=(prefix+name)))})}return "const style=document.createElement('style');style.textContent="+JSON.stringify(root.toString())+";document.head.append(style);export default "+JSON.stringify(names)};`)
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh:()=>{window.connectionRefreshes=(window.connectionRefreshes||0)+1},push:()=>{throw Error("Unexpected push")}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "dynamic.js"), 'import React,{useEffect,useState} from "react";export default function dynamic(loader){return function FixtureDynamic(props){const[Component,setComponent]=useState(null);useEffect(()=>{let active=true;loader().then(value=>{if(active)setComponent(()=>value.default||value)});return()=>{active=false}},[]);return Component?React.createElement(Component,props):null}}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "actions.js"), `export async function saveClientAccount(slug,input){window.savedInput={...input,privateToken:!!input.privateToken};return {ok:true,accounts:[{...window.account,calendarId:input.calendarId,calendarName:'Visits'}]}}export async function removeClientAccount(){if(window.failRetirement){window.failRetirement=false;return {ok:false,error:'Fixture retirement failed'}}window.removed=true;return {ok:true,accounts:[{...window.account,connected:false,revision:null,locationId:null,calendarId:null},{...window.account,connected:false,historyId:window.account.revision,retiredAt:'2026-10-13T00:00:00Z'}]}}export async function refreshClientAccount(){return {ok:true,accounts:[window.account]}}`)
    const appointmentPortal = process.env.BE_APPOINTMENT_PORTAL_FIXTURE === "1"
    writeFileSync(join(directory, "entry.tsx"), appointmentPortal ? `import React from "react";import{createRoot}from"react-dom/client";import{ClientPortalShell}from"@/components/client-portal/ClientPortalShell";
const summary={reference:'appointment-fixture',title:'Shared appointment fixture',calendarName:'Estimates',contactName:'SYNTHETIC SHARED CONTACT',startTime:'2026-09-01T00:30:00Z',endTime:'2026-09-01T01:30:00Z',timezone:'America/Chicago',timezoneKnown:true,status:'confirmed',removed:false,contactDetails:'synthetic@example.test',meetingDetails:'Synthetic office',bookingDetails:'Six windows',observedAt:'2026-08-14T12:00:00Z',version:4,details:{schemaVersion:1,contact:{phone:'+1 202 555 0123',email:'synthetic@example.test',company:'Fixture company',address:'Synthetic address'},meeting:{location:'Synthetic office',joinUrl:null},booking:{state:'available',text:'Six windows'},source:{createdAt:'2026-08-01T12:00:00Z'},lead:{source:'facebook_lead_ads',type:'new-lead',capturedAt:'2026-08-14T12:00:00Z',fields:[{fieldId:'rooms',label:'Which rooms need replacement windows?',value:'Kitchen and living room'}]}}};window.appointmentFixture=summary;
createRoot(document.getElementById('root')).render(<ClientPortalShell token="fixture" workspaceName="Example Agency" primaryPersonName="Alex" overview={{hasFulfilment:true,leadMode:new URLSearchParams(location.search).get('leadMode')??'ghl',actions:[],progress:[]}} initialAppointment={location.pathname.startsWith('/appointment/')?{id:'appointment-fixture',calendarId:'secondcalendar123',summary,notifiedVersion:4}:undefined}/>);`
    : `import React from "react";import{createRoot}from"react-dom/client";import{ClientConnectionsWorkspace}from"@/components/client-connections/ClientConnectionsWorkspace";import{ClientPortalCalendar}from"@/components/client-portal/ClientPortalCalendar";
window.account={relationshipId:'relationship',clientName:'Synthetic Client',businessName:'Fixture Business',accountType:'agency_subaccount',connected:true,locationId:'location123456789',locationName:'Fixture Location',revision:'00000000-0000-4000-8000-000000000001',calendarId:'calendar123456789',calendarName:'Visits',refreshedAt:null,readyAt:null,error:null,busy:false};createRoot(document.getElementById('root')).render(location.pathname==='/portal'?<div style={{background:'white',color:'black',padding:12}}><ClientPortalCalendar token="fixture" active={true}/></div>:<ClientConnectionsWorkspace workspaceSlug="fixture" accounts={[window.account,{...window.account,relationshipId:'other-client',clientName:'Other Client',businessName:null},{...window.account,relationshipId:'archived-client',clientName:'Archived Client',businessName:null,archived:true}]} agency={{connected:true,name:'Fixture Agency',id:'company123456789'}} canManageAgency={false}/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: strict ? "development" : "production", devtool: false,
        plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }), new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: strict ? "development" : "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { ...calendarAlias, "next/dynamic$": join(directory, "dynamic.js"), "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"),
            "@/app/[workspaceSlug]/client-connections/actions$": join(directory, "actions.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname
        if (path === "/oauth-fixture-callback") {
            const result = ghlPopupResponse(url.searchParams.get("state"), true)
            response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return
        }
        if (path.endsWith("/client-connections/advertising")) { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"accounts":[],"nextCursor":null}'); return }
        if (path.startsWith("/api/")) { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"calendars":[{"id":"calendar123456789","name":"Visits"},{"id":"secondcalendar123","name":"Estimates"}]}'); return }
        const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><button id="outside" style="padding:16px">Uncovered control</button><iframe name="betelgeze-tab:transfer-fixture" title="Retained transfer tab" src="/frame${url.search}" style="width:100%;height:750px;border:0"></iframe></body></html>`
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : path.endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' : path === "/host" ? host : path === "/blank" ? "<!doctype html><html><body>Departed iframe</body></html>" : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
