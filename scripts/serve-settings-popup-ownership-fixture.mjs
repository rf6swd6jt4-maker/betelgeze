// Actual settings/admin popup owners with synthetic local data and no writes.
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
const strict = process.env.SETTINGS_POPUP_STRICT === "1"
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-settings-popup-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh:()=>{throw Error("Unexpected refresh")},push:()=>{throw Error("Unexpected push")}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "actions.js"), 'const unexpected=async()=>{throw Error("No writes are permitted in this fixture")};export const saveOnboardingService=unexpected,setOnboardingServiceState=unexpected,saveAgencyBranding=unexpected,publishVisualThemeDraft=unexpected,addOkrKeyResult=unexpected,addOkrMeasurement=unexpected,commitOkr=unexpected,createOkrAction=unexpected,createOkrFromModal=unexpected,deleteOkrInline=unexpected,deleteOkrKeyResult=unexpected,linkOkrAction=unexpected,setOkrKeyResultCadence=unexpected,setOkrStatus=unexpected,unlinkOkrAction=unexpected,updateActiveOkrDetails=unexpected,updateActiveOkrKeyResultDescription=unexpected,updateDraftOkrKeyResultMetric=unexpected,updateOkr=unexpected,updateOkrKeyResult=unexpected;')
    writeFileSync(join(directory, "preview.js"), 'import React from "react";export function BuilderPreview(){return React.createElement("div",{"data-preview-leaf":true},"Synthetic public preview content")}')
    const baselineAliases = {}
    for (const [name, file] of Object.entries({ OkrWorkspace: "components/admin/OkrWorkspace.tsx", ServiceCatalogue: "components/settings/ServiceCatalogue.tsx", WorkspaceInvitationForm: "components/admin/WorkspaceInvitationForm.tsx", AgencyBrandingEditor: "components/settings/AgencyBrandingEditor.tsx" })) {
        if (!process.env.SETTINGS_POPUP_BASELINE) continue
        const path = join(directory, `${name}.tsx`)
        writeFileSync(path, execFileSync("git", ["show", `${process.env.SETTINGS_POPUP_BASELINE}:${file}`]))
        baselineAliases[`@/${file.slice(0, -4)}$`] = path
    }
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{ServiceCatalogue}from"@/components/settings/ServiceCatalogue";
import{OkrWorkspace}from"@/components/admin/OkrWorkspace";
import{WorkspaceInvitationForm}from"@/components/admin/WorkspaceInvitationForm";
import{AgencyBrandingEditor}from"@/components/settings/AgencyBrandingEditor";
import{WorkspaceNavigationProvider}from"@/components/workspace/WorkspaceNavigation";
import{DEFAULT_ONBOARDING_THEME}from"@/lib/onboarding/theme";
import{WORKSPACE_TAB_VISIBILITY_EVENT}from"@/lib/workspace-tabs";
const query=new URLSearchParams(location.search);const type=query.get("type")||"service";const fixtureState={};
const framed=window.parent!==window;
const service={id:"service-1",code:"fixture",name:"Fixture service",description:"",serviceType:"one_time",currency:"USD",defaultUpfrontPriceCents:1000,defaultRecurringPriceCents:0,defaultBillingInterval:"month",defaultBillingIntervalCount:1,recurringName:"",recurringDescription:"",state:"active",version:1,isTest:false,thumbnailUrl:null,thumbnailPath:null,thumbnailTemplateId:null,sortOrder:0,modules:[],archiveBlockers:[],requiredConnectionKeys:[],displayPriority:100};
const swatches=Object.entries(DEFAULT_ONBOARDING_THEME).map(([id,hex])=>({id,name:id,hex,hidden:false}));
const theme={id:null,swatches,assignments:Object.fromEntries(swatches.map(s=>[s.id,s.id])),updatedAt:null,updatedBy:null};
const published={...theme,swatches:swatches.map(s=>s.id==="primary"?{...s,hex:"#000000"}:s)};
const noWrite=async()=>{throw Error("Unexpected write")};const inviteAction=query.has("invite-success")?()=>new Promise(resolve=>{fixtureState.resolveInvite=resolve}):noWrite;
function Fixture(){const[active,setActive]=useState(true);window.fixture={resolveInvite(){fixtureState.resolveInvite?.({ok:true,message:"Sent"})},setActive(value){if(framed){window.frameElement.hidden=!value;document.body.dataset.workspaceTabActive=String(value);window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))}else setActive(value)}};
const body=<main hidden={!active} inert={!active} className="p-5">{type==="service"?<ServiceCatalogue workspaceSlug="fixture" services={[service]} assignees={[]} modules={[]} eligibleUsers={{"service-1":[]}} initialServiceId={query.has("initial")?"service-1":null} schemaReady/>:type==="invitation"?<WorkspaceInvitationForm workspaceSlug="fixture" action={inviteAction} canInviteAdmins services={[]}/>:type==="okr"?<OkrWorkspace workspaceSlug="fixture" currentUserId="actor" okrs={[]} ownerOptions={[{user_id:"actor",role:"admin",name:"Fixture user"}]} workItems={[]} people={{actor:"Fixture user"}} today="2026-10-01"/>:<AgencyBrandingEditor workspaceSlug="fixture" workspaceName="Fixture" initialTheme={theme} publishedTheme={published} previewBookend={{}} help={{text:"",whatsappEnabled:false,whatsappVerified:false,whatsappNumber:null}} schemaReady brandAssetSchemaReady logoSrc={null} faviconSrc={null} uploadLogo={noWrite} uploadFavicon={noWrite}/>}</main>;
return <><button id="outside" className="p-4">Uncovered control</button>{framed?body:<WorkspaceNavigationProvider value={{tabId:"native-settings",workspaceSlug:"fixture",url:"/fixture/settings",active,push:noWrite,replace:noWrite,refresh:noWrite,back:noWrite,forward:noWrite,prefetch:noWrite,context:()=>{}}}>{body}</WorkspaceNavigationProvider>}</>};createRoot(document.getElementById("root")).render(${strict ? "<React.StrictMode><Fixture/></React.StrictMode>" : "<Fixture/>"});`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: strict ? "development" : "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: strict ? "development" : "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { ...baselineAliases, "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"),
            "@/app/[workspaceSlug]/admin/actions$": join(directory, "actions.js"), "@/app/[workspaceSlug]/settings/service-actions$": join(directory, "actions.js"), "@/app/[workspaceSlug]/settings/branding-actions$": join(directory, "actions.js"), "@/app/[workspaceSlug]/onboarding-builder/visual-actions$": join(directory, "actions.js"), "@/components/onboarding-builder/BuilderPreview$": join(directory, "preview.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname
        if (path === "/api/workspaces/fixture/users/lookup" && url.searchParams.get("identifier") === "fixture@example.invalid") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ status:"on_betelgeze",accountExists:true,email:"fixture@example.invalid",username:"fixture",canInvite:true,actionLabel:"Invite to workspace" })); return }
        if (path.startsWith("/api/")) { response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"error":"Unexpected fixture request"}'); return }
        const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><button id="outside" style="padding:16px">Uncovered control</button><iframe name="betelgeze-tab:settings-fixture" title="Retained settings tab" src="/frame${url.search}" style="width:100%;height:750px;border:0"></iframe></body></html>`
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : path.endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' : path === "/host" ? host : path === "/blank" ? "<!doctype html><html><body>Departed iframe</body></html>" : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
