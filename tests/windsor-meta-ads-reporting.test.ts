import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260914120000_windsor_meta_ads_reporting.sql", "utf8")
const provider = readFileSync("lib/windsor.ts", "utf8")
const server = readFileSync("lib/onboarding/windsor-meta-ads-server.ts", "utf8")
const component = readFileSync("components/onboarding/WindsorMetaAdsConnectionBlock.tsx", "utf8")
const serviceTemplates = readFileSync("lib/onboarding/service-templates.ts", "utf8")

test("Meta Ads templates install Windsor while the direct Meta connection remains separate", () => {
    assert.match(serviceTemplates, /connectionKey: "windsor"/u)
    assert.match(migration, /p_template_id = 'meta-ads' and p_connection_provider = 'windsor'/u)
    assert.match(migration, /requiredConnectionKeys.*windsor/u)
    assert.match(migration, /relationship_windsor_meta_ads_connections/u)
    assert.doesNotMatch(migration, /drop table.*relationship_meta_ads_connections/iu)
})

test("client authorization is Facebook-only, token-bound, encrypted, and explicitly verified", () => {
    assert.match(provider, /allowed_sources", "facebook"/u)
    assert.match(provider, /co-user-linked-accounts/u)
    assert.match(provider, /access_token/u)
    assert.match(server, /encryptIntegrationCredential/u)
    assert.match(server, /p_authorization_hash/u)
    assert.match(server, /listWindsorMetaAdsAccounts/u)
    assert.match(component, /Check connection/u)
    assert.match(component, /press <strong>Finish<\/strong>/u)
    assert.doesNotMatch(component, /setInterval|poll/iu)
})

test("completion is server verified and binds one account to one relationship", () => {
    assert.match(migration, /unique \(workspace_id, relationship_id\)/u)
    assert.match(migration, /relationship_windsor_meta_ads_account_unique/u)
    assert.match(migration, /current_user <> 'service_role'/u)
    assert.match(migration, /requirement_kind.*'meta_ads_connected'/u)
    assert.match(migration, /authorization_encrypted = null/u)
})
