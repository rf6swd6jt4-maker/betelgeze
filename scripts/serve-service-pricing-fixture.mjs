// Actual POS, correction dialog and payment summary with synthetic data; no external requests.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const strict = process.env.SERVICE_TRANSFER_STRICT === "1"
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-service-pricing-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source.replace(/import\\(/g,'import(/* webpackMode: "eager" */'),{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh:()=>{throw Error("Unexpected refresh")},push:()=>{throw Error("Unexpected push")}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "actions.js"), 'export async function sellRelationshipServices(s,r,input){return window.fixtureSell(input)};export async function retryServiceSaleConfirmation(){throw Error("Unexpected retry")};export async function correctUnpaidServiceSale(s,r,u,input){return window.fixtureCorrect(input)}')
    writeFileSync(join(directory, "workspace.js"), 'export const useWorkspaceNavigation=()=>null;export const useRouter=()=>({refresh:()=>{window.fixtureRefreshed=true}})')
    writeFileSync(join(directory, "contact.js"), 'export const ContactThumbnail=()=>null')
    writeFileSync(join(directory, "preview.js"), 'export const BuilderPreview=()=>null;export const OnboardingPreviewOverlay=()=>null')
    writeFileSync(join(directory, "dynamic.js"), 'import React from "react";export default function dynamic(load){const Component=React.lazy(()=>load().then(defaultExport=>({default:defaultExport})));return props=>React.createElement(React.Suspense,{fallback:null},React.createElement(Component,props))}')
    writeFileSync(join(directory, "entry.tsx"), "import React,{useState}from\"react\";import{createRoot}from\"react-dom/client\";\nimport{RelationshipServicePos}from\"@/components/relationships/RelationshipServicePos\";\nimport{ServicePriceCorrection}from\"@/components/relationships/ServicePriceCorrection\";\nimport{ServicePriceSummary}from\"@/components/services/ServicePriceSummary\";\nconst id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,\"0\")}`;\nconst yearly=new URLSearchParams(location.search).has(\"yearly\");\nconst row=(n:number,name:string,interval:string)=>({id:id(n),service_id:id(n+10),name,version:1,stage:\"negotiating\",disposition:\"active\",service_type:\"retainer\",billing_interval:interval,billing_interval_count:1,currency:\"USD\",upfront_cents:50000,recurring_cents:150000,assignee_user_id:id(3),assignee_name:\"Alex\"});\nconst data={items:[row(1,\"Growth service\",yearly?\"year\":\"month\"),row(2,\"Weekly service\",\"week\")],hasMore:false,managers:[{id:id(3),name:\"Alex\"}],sales:[],contacts:[{provider:\"twilio_sms\",added:true,enabled:true,state:\"active\",canSend:true,address:\"+15555550123\"}]};\nif(new URLSearchParams(location.search).get(\"mode\")===\"paid-recovery\")data.sales=[{id:id(5),status:\"paid\",services:[{id:id(6),name:\"Growth service\"}],currency:\"USD\",upfront_total_amount:0,recurring_total_amount:150000,billing_interval:\"month\",billing_interval_count:1,can_correct_prices:false}];\nwindow.fixturePage=data;\nfunction Fixture(){const[open,setOpen]=useState(true);const mode=new URLSearchParams(location.search).get(\"mode\");return <main style={{maxWidth:800,margin:\"auto\",padding:16}}>{mode===\"correction\"?open?<ServicePriceCorrection workspaceSlug=\"fixture\" relationshipId={id(4)} userId={id(3)} saleId={id(5)} onClose={()=>setOpen(false)} onSaved={()=>{window.fixtureDone=true;setOpen(false)}}/>:<p>Correction saved or closed</p>:mode===\"public\"?<div className=\"bg-white p-4 text-black\"><ServicePriceSummary surface=\"light\" pricing={{upfrontCents:50000,recurringCents:150000,currency:\"USD\",billingInterval:\"month\",billingIntervalCount:1}}/><button>Continue to payment</button></div>:<RelationshipServicePos workspaceSlug=\"fixture\" relationshipId={id(4)} userId={id(3)} initial={data} relationship={{name:\"Client\",company:null,email:\"fixture@example.test\",phone:\"+15555550123\",updatedAt:\"2026-10-12T00:00:00Z\",managerId:id(3)}}/>}</main>};\ncreateRoot(document.getElementById(\"root\")).render(<Fixture/>);\n")
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: strict ? "development" : "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: strict ? "development" : "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"),
            "@/app/[workspaceSlug]/relationships/service-sale-actions$": join(directory, "actions.js"),
            "@/app/[workspaceSlug]/relationships/price-correction-actions$": join(directory, "actions.js"),
            "@/components/workspace/WorkspaceNavigation$": join(directory, "workspace.js"),
            "@/components/relationships/RelationshipContactCards$": join(directory, "contact.js"),
            "@/components/onboarding-builder/BuilderPreview$": join(directory, "preview.js"),
            "@/components/onboarding-builder/OnboardingPreviewOverlay$": join(directory, "preview.js"),
            "./RelationshipContactCards$": join(directory, "contact.js"), "next/dynamic$": join(directory, "dynamic.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname
        if (path.startsWith("/api/")) { response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"error":"Unexpected fixture request"}'); return }
        const host = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><button id="outside" style="padding:16px">Uncovered control</button><iframe name="betelgeze-tab:transfer-fixture" title="Retained transfer tab" src="/frame${url.search}" style="width:100%;height:750px;border:0"></iframe></body></html>`
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : path.endsWith(".svg") ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' : path === "/host" ? host : path === "/blank" ? "<!doctype html><html><body>Departed iframe</body></html>" : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
