// Actual shared UI, synthetic local state, no account or provider I/O.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-ui-reconciliation-"))
const baseline = process.env.UI_RECONCILIATION_BASELINE
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "navigation.js"), `import {createContext,useContext} from "react";export const Navigation=createContext(null);export const useWorkspaceNavigation=()=>useContext(Navigation);`)
    const dialogPath = "components/ui/CenteredDialog.tsx"
    writeFileSync(join(directory, "Dialog.tsx"), baseline ? execFileSync("git", ["show", `${baseline}:${dialogPath}`]) : readFileSync(dialogPath))
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState} from "react";import {createRoot} from "react-dom/client";
import {CenteredDialog} from "./Dialog";import {Navigation} from "./navigation";
import {PullToRefresh} from "@/components/workspace/PullToRefresh";
import {WorkspaceBannerPending} from "@/components/admin/WorkspaceBannerPending";
function Fixture(){const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[active,setActive]=useState(true),[refreshing,setRefreshing]=useState(true);
window.fixture={open:setOpen,busy:setBusy,active:setActive,refreshing:setRefreshing,closedAtCallback:[],dismiss(){window.fixture.closedAtCallback.push(window.parent.document.querySelector('dialog')?.open);window.releaseDismiss=()=>setOpen(false)}};
return <Navigation.Provider value={{active}}><header className="fixed top-0 left-0 h-10 w-full" data-header>Unchanged header</header><main className="mt-12"><button id="opener" onClick={()=>setOpen(true)}>Open synthetic dialog</button><button id="underlying">Underlying control</button><div data-refresh-host className="relative h-40"><PullToRefresh active={active} refreshing={refreshing} onRefresh={()=>{}} placement="absolute"/></div><WorkspaceBannerPending/>{open?<CenteredDialog title="Synthetic dialog" busy={busy} onClose={()=>window.fixture.dismiss()}><input aria-label="Synthetic field"/></CenteredDialog>:null}</main></Navigation.Provider>};createRoot(document.getElementById('root')).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false, entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" }, resolve: { alias: { "@/components/workspace/WorkspaceNavigation$": join(directory, "navigation.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const framed = '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><iframe title="Synthetic resident panel" src="/frame" style="width:100%;height:800px;border:0"></iframe></body></html>'
    const server = createServer((request, response) => { const path = new URL(request.url, "http://127.0.0.1").pathname; response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" });response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : path === "/host" ? framed : html) })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
