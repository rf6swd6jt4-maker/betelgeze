#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Iteration packs only. The release workflow always runs the complete suite.
export function foundationPacks(paths) {
    const packs = new Set()
    for (const path of paths) {
        if (/^(docs\/|.*AGENTS\.md$)/.test(path)) continue
        if (/leadgen|sunbiz|arizona-owner|services\/ner/.test(path)) packs.add("retirement")
        else if (/viewport|visual-origin|composer|app\/globals\.css/.test(path)) { packs.add("mobile"); packs.add("workspace"); packs.add("alerts") }
        else if (/communications|client-messages|lib\/push|public\/sw\.js|app\/api\/push/.test(path)) { packs.add("alerts"); packs.add("mobile") }
        else if (/client-portal/.test(path)) packs.add("portal")
        else if (/workspace|components\/work-items|draft/.test(path)) { packs.add("workspace"); packs.add("records") }
        else if (/attachment|record-|lib\/(notes|assets|sops)|components\/(detail|sops)|\/(notes|assets|sops)\//.test(path)) packs.add("records")
        else if (/^(app|components|lib|supabase|scripts|tests|\.github)\/|^(package|next\.config|proxy\.)/.test(path)) packs.add("full")
    }
    return [...packs].sort()
}
export function selectFoundationTests(packs, files) {
    const patterns = {
        workspace: /^workspace-|^foundation-/, mobile: /viewport|composer/,
        alerts: /communications|chat-read|reading-|unread|chat-push|app-alerts|message-/,
        portal: /^client-portal/, records: /attachment|record-|sop-records|workspace-draft/,
        retirement: /^leadgen-retirement|^workspace-access|^ui-(list|detail)/,
    }
    return files.filter(file => /\.test\.[cm]?[jt]s$/.test(file) && (packs.includes("full") || packs.some(pack => patterns[pack]?.test(file)))).sort()
}
function git(args) {
    const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
    if (result.status !== 0) throw Error(result.stderr || "git failed")
    return result.stdout
}
function main() {
    const args = process.argv.slice(2)
    if (args[0] !== "--base" || !args[1] || args[1].startsWith("-") || args.slice(2).some(value => value !== "--list")) throw Error("Usage: run-foundation-regressions.mjs --base <ref> [--list]")
    const base = git(["rev-parse", "--verify", "--end-of-options", `${args[1]}^{tree}`]).trim()
    const paths = [...new Set((git(["diff", "--name-only", "-z", base, "--"]) + git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean))]
    const packs = foundationPacks(paths)
    const files = selectFoundationTests(packs, readdirSync("tests"))
    console.log(JSON.stringify({ packs, tests: files, releaseStillRequiresFullSuite: true }, null, 2))
    if (args.includes("--list") || !files.length) return
    const result = spawnSync(process.execPath, ["--test", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...files.map(file => `tests/${file}`)], { stdio: "inherit" })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
