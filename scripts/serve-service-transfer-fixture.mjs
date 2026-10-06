// Actual settings/admin popup owners with synthetic local data and no writes.
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
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-service-transfer-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh:()=>{throw Error("Unexpected refresh")},push:()=>{throw Error("Unexpected push")}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "actions.js"), 'export async function transferRelationshipService(slug,relationship,input){return window.fixtureTransfer(input)}')
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{ServiceTransferDialog}from"@/components/relationships/ServiceTransferDialog";
function Fixture(){const[open,setOpen]=useState(true);const recoveryOnly=new URLSearchParams(location.search).has("recovery");return <>{open?<ServiceTransferDialog row={{id:"00000000-0000-4000-8000-000000000006",name:"Appointment Setting",service_id:"service",assignee_name:"Alex Morgan",assignee_user_id:"00000000-0000-4000-8000-000000000004",stage:recoveryOnly?"completed":"setup",disposition:recoveryOnly?"cancelled":"active"}} recoveryOnly={recoveryOnly} endpoint="/api/services" workspaceSlug="fixture" relationshipId="relationship" userId="00000000-0000-4000-8000-000000000003" onClose={()=>setOpen(false)} onDone={()=>{window.fixtureDone=true;setOpen(false)}}/>:<p>Closed</p>}</>};createRoot(document.getElementById("root")).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: strict ? "development" : "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: strict ? "development" : "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"),
            "@/app/[workspaceSlug]/relationships/service-actions$": join(directory, "actions.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
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
