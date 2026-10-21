// Called by the isolated GHL fixture. Real pgcrypto; synthetic Vault/key adapter.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { repositoryRoot } from "./ghl-sql-fixture.mjs"
const key = "00000000-0000-4000-8000-000000001111", vault = "00000000-0000-4000-8000-000000001112"
export async function installTemplateEvidenceFixture(db) {
    await db.exec(`create schema communications_secure;
        create table communications_secure.content_keys(id uuid primary key,vault_secret_id uuid);
        insert into communications_secure.content_keys values('${key}','${vault}');
        insert into vault.decrypted_secrets(id,decrypted_secret) values('${vault}','synthetic-evidence-key');
        alter table public.client_messages add column body_ciphertext bytea, add column body_key_id uuid, add column body_encryption_version integer, add column raw_payload_ciphertext bytea;
        create function communications_secure.get_or_create_content_key(w uuid,k text,s uuid) returns table(key_id uuid,key_version integer,secret text) language sql as $$select k.id,1,v.decrypted_secret from communications_secure.content_keys k join vault.decrypted_secrets v on v.id=k.vault_secret_id order by k.id desc limit 1$$;`)
    const encryption = await readFile(`${repositoryRoot}/supabase/migrations/20260821150000_encrypted_communications.sql`, "utf8")
    const redaction = await readFile(`${repositoryRoot}/supabase/migrations/20260821153000_encrypt_communication_delivery_payloads.sql`, "utf8")
    await db.exec(redaction.slice(redaction.indexOf('create or replace function communications_secure.redact_message_json'), redaction.indexOf('alter table public.communication_message_deliveries')))
    await db.exec(encryption.slice(encryption.indexOf('create or replace function communications_secure.encrypt_client_message'), encryption.indexOf('drop trigger if exists encrypt_client_message')))
    const migration = await readFile(`${repositoryRoot}/supabase/migrations/20261022012000_whatsapp_template_evidence.sql`, "utf8")
    try { await db.exec(migration) } catch (error) {
        if (error.position) console.error(migration.slice(Math.max(0, Number(error.position) - 220), Number(error.position) + 220))
        throw error
    }
}
export async function validateTemplateEvidenceFixture(db, workspace, relationship) {
    const scalar = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0]
    const token = "d".repeat(64), suffix = `${token}?v=3`
    const evidence = { schemaVersion: 1, templateId: "1415800937309351", templateName: "be_appointment_added", language: "en_US", capturedAt: new Date().toISOString(), buttons: [{ index: 0, type: "url", label: "View appointment", url: `https://portal.scaylup.com/appointment/${suffix}` }], components: [{ type: "body", parameters: Array.from({ length: 9 }, () => ({ type: "text", text: "Synthetic parameter" })) }, { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: suffix }] }] }
    const valid = async (candidate) => (await scalar("select client_portal_secure.ghl_template_evidence_valid($1::jsonb,'added',$2,3,'https://portal.scaylup.com') valid", [JSON.stringify(candidate), token])).valid
    assert.equal(await valid(evidence), true)
    for (const wrong of [null, {}, { ...evidence, templateId: "wrong" }, { ...evidence, capturedAt: "not-a-date" }, { ...evidence, buttons: [{ ...evidence.buttons[0], url: "https://other.example/" }] }, { ...evidence, components: [{ ...evidence.components[0], parameters: [] }, evidence.components[1]] }, { ...evidence, buttons: [...evidence.buttons, evidence.buttons[0]] }]) assert.equal(await valid(wrong), false)
    assert.equal((await scalar("select has_function_privilege('authenticated','client_portal_secure.ghl_template_evidence_valid(jsonb,text,text,bigint,text)','execute') allowed")).allowed, false)
    await db.exec(`create trigger encrypt_client_message before insert or update of body,raw_payload on public.client_messages for each row execute function communications_secure.encrypt_client_message();`)
    const raw = { template_evidence: { text: JSON.stringify(evidence) }, template_name: evidence.templateName }
    const message = await scalar("insert into public.client_messages(workspace_id,relationship_id,body,raw_payload,status) values($1,$2,'Synthetic body',$3,'sending') returning id,body,raw_payload,raw_payload_ciphertext", [workspace, relationship, JSON.stringify(raw)])
    assert.equal(message.body, null)
    assert.deepEqual(message.raw_payload.template_evidence, { text: "[encrypted]" })
    assert.equal(JSON.stringify(message.raw_payload).includes(token), false)
    const read = async () => scalar("select extensions.pgp_sym_decrypt(raw_payload_ciphertext,'synthetic-evidence-key')::jsonb payload,extensions.pgp_sym_decrypt(body_ciphertext,'synthetic-evidence-key') body,raw_payload_ciphertext from public.client_messages where id=$1", [message.id])
    assert.deepEqual((await read()).payload, raw)
    await db.query("update public.client_messages set body='Body edit' where id=$1", [message.id])
    assert.deepEqual((await read()).raw_payload_ciphertext, message.raw_payload_ciphertext, "Body-only edit preserves original evidence ciphertext without another payload encryption")
    assert.deepEqual((await read()).payload.template_evidence, raw.template_evidence)
    await db.query("update public.client_messages set status='delivered' where id=$1", [message.id])
    assert.deepEqual((await read()).payload.template_evidence, raw.template_evidence)
    await db.query("update public.client_messages set raw_payload=$2 where id=$1", [message.id, JSON.stringify({ provider_receipt: "synthetic" })])
    assert.deepEqual((await read()).payload.template_evidence, raw.template_evidence, "New metadata preserves immutable evidence")
    assert.equal((await read()).payload.provider_receipt, "synthetic")
    await assert.rejects(db.query("update public.client_messages set raw_payload=$2 where id=$1", [message.id, JSON.stringify({ template_evidence: { text: JSON.stringify({ ...evidence, language: "changed" }) } })]), /template_evidence_is_immutable/)
    await db.exec(`insert into vault.decrypted_secrets(id,decrypted_secret) values('00000000-0000-4000-8000-000000001114','synthetic-rotated-key');
        insert into communications_secure.content_keys values('00000000-0000-4000-8000-000000001113','00000000-0000-4000-8000-000000001114');`)
    await db.query("update public.client_messages set body='After key rotation' where id=$1", [message.id])
    const rotated = await scalar("select extensions.pgp_sym_decrypt(raw_payload_ciphertext,'synthetic-rotated-key')::jsonb payload,extensions.pgp_sym_decrypt(body_ciphertext,'synthetic-rotated-key') body from public.client_messages where id=$1", [message.id])
    assert.deepEqual(rotated.payload.template_evidence, raw.template_evidence)
    assert.equal(rotated.body, 'After key rotation')
    const legacy = await scalar("insert into public.client_messages(workspace_id,relationship_id,body,raw_payload) values($1,$2,'Legacy','{\"kind\":\"ordinary\"}') returning id", [workspace, relationship])
    await db.query("update public.client_messages set body='Still editable' where id=$1", [legacy.id])
    assert.equal((await scalar("select extensions.pgp_sym_decrypt(body_ciphertext,'synthetic-rotated-key') body from public.client_messages where id=$1", [legacy.id])).body, "Still editable")
    console.log("PASS template evidence: strict destination/version, encrypted roundtrip, redacted metadata, immutable history, body/receipt preservation and unchanged legacy edits")
}
