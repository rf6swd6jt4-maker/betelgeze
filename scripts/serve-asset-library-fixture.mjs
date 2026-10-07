// Real Library components with local synthetic assets; no external I/O or writes.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd()
const directory = mkdtempSync(join(tmpdir(), "be-asset-library-"))
const imageId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000002"
const missingId = "00000000-0000-4000-8000-000000000003"
const singleBytes = "Original library asset bytes\n"
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "navigation.js"), 'const router={refresh(){throw Error("Unexpected refresh")},push(url){location.href=url},replace(url){location.replace(url)},prefetch(){}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,prefetch,replace,scroll,onNavigate,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{AssetLibrary}from"@/components/library/AssetLibrary";
import{WorkspaceNavigationProvider}from"@/components/workspace/WorkspaceNavigation";
const entries=[
 {asset:{id:${JSON.stringify(imageId)},title:"Campaign image",content_type:"image/png",file_size:31,updated_at:"2026-10-07T09:00:00Z"},previewUrl:"/thumbnail.svg",downloadHref:"/api/workspaces/fixture/assets/${imageId}/download"},
 {asset:{id:${JSON.stringify(documentId)},title:"Procedure document",content_type:"application/pdf",file_size:46,updated_at:"2026-10-07T08:00:00Z"},previewUrl:null,downloadHref:"/api/workspaces/fixture/assets/${documentId}/download"},
 {asset:{id:${JSON.stringify(missingId)},title:"Asset without file",content_type:null,file_size:null,updated_at:"2026-10-07T07:00:00Z"},previewUrl:null,downloadHref:null}
];
function Fixture(){const[active,setActive]=useState(true),[records,setRecords]=useState(entries);window.fixture={setActive,reset(){setRecords(entries)},setLarge(){setRecords(current=>current.map((entry,index)=>index===0?{...entry,asset:{...entry.asset,file_size:501*1024*1024}}:entry))},setUnknown(){setRecords(current=>current.map((entry,index)=>index===1?{...entry,asset:{...entry.asset,file_size:null}}:entry))},setMany(count=26){setRecords(Array.from({length:count},(_,index)=>index<2?entries[index]:{...entries[1],asset:{...entries[1].asset,id:"00000000-0000-4000-8000-"+String(index+2).padStart(12,"0"),title:"Additional asset "+(index+1)}}))},revoke(id){setRecords(current=>current.map(entry=>entry.asset.id===id?{...entry,downloadHref:null}:entry))},remove(id){setRecords(current=>current.filter(entry=>entry.asset.id!==id))}};const body=<main className="mx-auto max-w-6xl p-4 sm:p-8" hidden={!active}><AssetLibrary workspaceSlug="fixture" previewEntries={records} counts={{total:records.length,images:1,documents:records.length-1,uploads:records.filter(entry=>entry.downloadHref).length}}/><button type="button" id="outside" className="mt-8 p-3">Outside control</button></main>;return window.parent!==window?body:<WorkspaceNavigationProvider value={{tabId:"asset-fixture",workspaceSlug:"fixture",url:"/fixture/assets",active,push(){},replace(){},refresh(){},back(){},forward(){},prefetch(){},context(){}}}>{body}</WorkspaceNavigationProvider>}
createRoot(document.getElementById("root")).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const files = new Map()
    async function compile(filename, additionalAliases = {}) {
        await new Promise((done, fail) => webpack({ mode: "production", devtool: false,
            plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
            entry: join(directory, "entry.tsx"), output: { path: directory, filename, chunkFilename: "asset-fixture-[id].js", publicPath: "/" },
            resolve: { alias: { ...additionalAliases, "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
            module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false },
        }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done()))
        for (const name of readdirSync(directory).filter(name => name.endsWith(".js"))) files.set(`/${name}`, readFileSync(join(directory, name)))
    }
    await compile("bundle.js")
    if (process.env.ASSET_LIBRARY_BASELINE_REF) {
        const aliases = {}
        for (const source of ["components/library/AssetLibrary.tsx", "components/ui/AssetGallery.tsx"]) {
            const file = join(directory, `baseline-${source.split("/").at(-1)}`)
            writeFileSync(file, execFileSync("git", ["show", `${process.env.ASSET_LIBRARY_BASELINE_REF}:${source}`], { cwd: root }))
            aliases[`@/${source.replace(/\.tsx$/, "")}$`] = file
        }
        await compile("baseline.js", aliases)
    }
    const css = await cssPromise
    const writer = new ZipWriter(new Uint8ArrayWriter())
    await writer.add("Campaign image.png", new TextReader(singleBytes))
    await writer.add("Procedure document.pdf", new TextReader("Original procedure document\n"))
    const archive = Buffer.from(await writer.close())
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">'
    const html = `<!doctype html><html><head>${head}</head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>`
    const host = `<!doctype html><html><head>${head}</head><body class="bg-neutral-950 text-white"><button id="host-outside" style="padding:16px">Outside frame control</button><iframe id="owner-frame" name="betelgeze-tab:asset-fixture" src="/?__betelgeze_tab=asset-fixture" style="display:block;width:100%;height:740px;border:0"></iframe></body></html>`
    const downloadRequests = []
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1")
        const path = url.pathname
        const headers = { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'" }
        if (path === "/__fixture/download-requests") {
            response.writeHead(200, { ...headers, "Content-Type": "application/json" })
            response.end(JSON.stringify(downloadRequests))
            return
        }
        if ([`/api/workspaces/fixture/assets/${imageId}/download`, `/api/workspaces/fixture/assets/${documentId}/download`].includes(path)) {
            downloadRequests.push(path)
            response.writeHead(200, { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="Campaign image.png"' })
            response.end(singleBytes)
            return
        }
        if (path === "/api/workspaces/fixture/assets/download" && url.searchParams.get("ids") === `${imageId},${documentId}`) {
            downloadRequests.push(`${path}${url.search}`)
            response.writeHead(200, { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="fixture-assets.zip"' })
            if (request.headers.referer && new URL(request.headers.referer).searchParams.get("stream") === "hold") {
                response.write(archive.subarray(0, Math.ceil(archive.length / 2)))
                const timer = setTimeout(() => response.end(archive.subarray(Math.ceil(archive.length / 2))), 30_000)
                response.once("close", () => clearTimeout(timer))
            } else response.end(archive)
            return
        }
        if (path.startsWith("/api/")) {
            response.writeHead(500, { ...headers, "Content-Type": "application/json" })
            response.end('{"error":"Unexpected asset fixture request"}')
            return
        }
        if (files.has(path)) {
            response.writeHead(200, { ...headers, "Content-Type": "text/javascript" })
            response.end(files.get(path))
            return
        }
        if (path === "/baseline") {
            response.writeHead(files.has("/baseline.js") ? 200 : 404, { ...headers, "Content-Type": "text/html" })
            response.end(files.has("/baseline.js") ? html.replace('/bundle.js', '/baseline.js') : 'Set ASSET_LIBRARY_BASELINE_REF to enable matched fixture timing observations.')
            return
        }
        const detail = path.startsWith("/fixture/assets/")
        response.writeHead(200, { ...headers, "Content-Type": path === "/style.css" ? "text/css" : path === "/thumbnail.svg" ? "image/svg+xml" : "text/html" })
        response.end(path === "/style.css" ? css : path === "/thumbnail.svg" ? '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#334155"/><circle cx="160" cy="120" r="60" fill="#94a3b8"/></svg>' : path === "/host" ? host : detail ? `<!doctype html><html><head>${head}</head><body class="bg-neutral-950 text-white"><h1>Asset destination</h1><p>${path}</p></body></html>` : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally {
    rmSync(directory, { recursive: true, force: true })
}
