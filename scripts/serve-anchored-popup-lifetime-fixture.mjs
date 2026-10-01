// Actual AnchoredPopup with synthetic iframe/native owners and no external I/O.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-anchored-lifetime-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "entry.tsx"), `import React,{useState}from"react";import{createRoot}from"react-dom/client";
import{AnchoredPopup}from"@/components/ui/AnchoredPopup";
import{WorkspaceNavigationProvider}from"@/components/workspace/WorkspaceNavigation";
function Fixture(){const[anchor,setAnchor]=useState(null),[active,setActive]=useState(true);window.fixture={setActive};const body=<main hidden={!active}><button id="popup-trigger" style={{marginTop:100}} onClick={event=>setAnchor(event.currentTarget)}>Open fixture menu</button>{anchor?<AnchoredPopup anchor={anchor} role="menu" onDismiss={()=>{window.dismissals=(window.dismissals||0)+1;setAnchor(null)}} className="rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-white"><button id="menu-action">Menu action</button></AnchoredPopup>:null}</main>;return window.parent!==window?body:<WorkspaceNavigationProvider value={{tabId:"native-fixture",workspaceSlug:"fixture",url:"/fixture",active,push(){},replace(){},refresh(){},back(){},forward(){},prefetch(){},context(){}}}>{body}</WorkspaceNavigationProvider>}
createRoot(document.getElementById("root")).render(<Fixture/>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">'
    const html = `<!doctype html><html><head>${head}</head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>`
    const host = `<!doctype html><html><head>${head}</head><body class="bg-neutral-950 text-white"><button id="outside">Outside control</button><iframe id="owner-frame" name="betelgeze-tab:fixture-frame" src="/?__betelgeze_tab=fixture-frame" style="display:block;width:350px;height:360px;margin-top:100px;border:0"></iframe></body></html>`
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : path === "/host" ? host : html)
    })
    server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
