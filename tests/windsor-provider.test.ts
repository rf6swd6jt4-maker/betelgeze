import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function provider(payload: unknown, status = 200) {
    const compiled = { exports: {} as { listWindsorMetaAdsAccounts: (key: string, token: string) => Promise<unknown>; createWindsorMetaAdsAuthorization: (key: string) => Promise<unknown> } }
    const calls: URL[] = []
    const code = ts.transpileModule(readFileSync("lib/windsor.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", "fetch", code)(() => ({}), compiled, compiled.exports, async (url: URL) => {
        calls.push(url); return new Response(JSON.stringify(payload), { status })
    })
    return { ...compiled.exports, calls }
}
test("Windsor account IDs accept safe numeric values and token-scoped duplicate rows", async () => {
    const p = provider({ data: [{ account_id: 1348332320788897, account_name: "Test", datasource: "facebook_ads", access_token: "link" }, { account_id: "1348332320788897", account_name: "Test", datasource: "facebook_ads" }] })
    assert.deepEqual(await p.listWindsorMetaAdsAccounts("agency", "link"), [{ id: "1348332320788897", name: "Test", datasource: "facebook_ads" }])
    assert.equal(p.calls[0].searchParams.get("access_token"), "link")
    assert.equal(p.calls[0].searchParams.has("ds_id"), false)
})
test("explicitly different links and non-Meta sources cannot satisfy onboarding", async () => {
    const p = provider([{ account_id: "one", datasource: "facebook_ads", access_token: "other" }, { account_id: "two", datasource: "google_ads" }])
    assert.deepEqual(await p.listWindsorMetaAdsAccounts("agency", "link"), [])
})
test("empty results differ from malformed or error payloads", async () => {
    assert.deepEqual(await provider({ accounts: [] }).listWindsorMetaAdsAccounts("agency", "link"), [])
    for (const payload of [{ error: "failed" }, null, { data: [{ datasource: "facebook_ads", account_id: Number.MAX_SAFE_INTEGER + 1 }] }, { data: [null] }]) {
        await assert.rejects(provider(payload).listWindsorMetaAdsAccounts("agency", "link"), /response|invalid account/)
    }
    await assert.rejects(provider({}, 403).listWindsorMetaAdsAccounts("agency", "link"), /needs attention/)
})
test("authorization destinations must be Windsor HTTPS links with an attempt token", async () => {
    const p = provider({ url: "https://onboard.windsor.ai/token-login?access_token=link" })
    assert.deepEqual(await p.createWindsorMetaAdsAuthorization("agency"), { authorizationUrl: "https://onboard.windsor.ai/token-login?access_token=link", accessToken: "link" })
    assert.equal(p.calls[0].searchParams.get("allowed_sources"), "facebook")
    for (const url of ["https://example.test/?access_token=link", "http://onboard.windsor.ai/?access_token=link", "https://onboard.windsor.ai/"]) await assert.rejects(provider({ url }).createWindsorMetaAdsAuthorization("agency"))
})

test("Meta datasource aliases are accepted without relying on the provider filter", async () => {
 const p = provider({data:[{account_id:"one",datasource:"facebook",account_name:"Alias account"},{account_id:"two",datasource:"google_ads"}]})
 assert.deepEqual(await p.listWindsorMetaAdsAccounts("agency","link"),[{id:"one",name:"Alias account",datasource:"facebook"}])
})

test("grouped Windsor accounts inherit only their explicit Meta source", async () => {
 const p = provider({data:[{access_token:"link",accounts:{facebook_ads:[{account_id:"one",account_name:"Grouped account"}]}}]})
 assert.deepEqual(await p.listWindsorMetaAdsAccounts("agency","link"),[{id:"one",name:"Grouped account",datasource:"facebook_ads"}])
 const foreign = provider({data:[{access_token:"other",accounts:{facebook_ads:[{account_id:"one"}]}}]})
 assert.deepEqual(await foreign.listWindsorMetaAdsAccounts("agency","link"),[])
})
