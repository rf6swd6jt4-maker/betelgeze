// Isolated synthetic data only. Existing decoder/permission function definitions
// and pgcrypto are real; Auth JWTs and the Vault decrypted-secret source are adapters.
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { PGlite, repositoryRoot as root } from "./pglite-fixture.mjs"
const require = createRequire(import.meta.url)
const { pgcrypto } = require(require.resolve("@electric-sql/pglite/contrib/pgcrypto", { paths: process.env.BE_PGLITE_ROOT ? [process.env.BE_PGLITE_ROOT] : [root] }))
const db = new PGlite({ extensions: { pgcrypto } })
const migration = async (name) => readFile(`${root}/supabase/migrations/${name}`, "utf8")
const definition = (source, name) => {
    const start = source.indexOf(`create or replace function ${name}(`) >= 0 ? source.indexOf(`create or replace function ${name}(`) : source.indexOf(`create function ${name}(`)
    if (start < 0) throw new Error(`Missing existing function ${name}`)
    return source.slice(start, source.indexOf("$$;", start) + 3)
}
try {
    await db.exec(`
        create role authenticated; create role service_role; create role anon;
        create schema auth; create schema extensions; create schema communications_secure; create schema vault;
        create extension pgcrypto with schema extensions;
        create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
        create function current_session_is_aal2() returns boolean language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2' $$;
        create table workspace_memberships(workspace_id uuid,user_id uuid);
        create function is_workspace_member(w uuid) returns boolean language sql stable as $$ select exists(select 1 from public.workspace_memberships where workspace_id=w and user_id=auth.uid()) $$;
        create table relationships(id uuid primary key,workspace_id uuid,seller_user_id uuid,fulfilment_manager_user_id uuid,status text);
        create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid);
        create table workspace_native_conversations(id uuid primary key,workspace_id uuid,kind text,team_id uuid);
        create table workspace_native_conversation_participants(conversation_id uuid,user_id uuid);
        create table workspace_team_members(team_id uuid,user_id uuid);
        create table workspace_native_conversation_visibility(conversation_id uuid,user_id uuid,cleared_at timestamptz);
        create table communications_secure.content_keys(id uuid primary key,vault_secret_id uuid);
        create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
        create table client_messages(id uuid primary key,client_request_id uuid,workspace_id uuid,relationship_id uuid,body text,direction text,provider text,provider_message_id text,whatsapp_message_id text,reply_to_whatsapp_message_id text,reply_to_message_id uuid,status text,error text,sender_kind text,sender_user_id uuid,automation_kind text,automation_label text,created_at timestamptz,sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz,raw_payload jsonb,body_ciphertext bytea,raw_payload_ciphertext bytea,body_key_id uuid);
        create table workspace_native_messages(id uuid primary key,client_request_id uuid,workspace_id uuid,conversation_id uuid,sender_user_id uuid,sender_workspace_role text,body text,reply_to_message_id uuid,attachment jsonb,created_at timestamptz,body_ciphertext bytea,attachment_ciphertext bytea,quote_ciphertext bytea,body_key_id uuid);
        create index client_workspace_created on client_messages(workspace_id,created_at desc);
        create index native_conversation_created on workspace_native_messages(conversation_id,created_at desc);
        insert into workspace_memberships values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
        insert into relationships values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',null,'active');
        insert into workspace_native_conversations values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','direct',null);
        insert into workspace_native_conversation_participants values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002');
        insert into communications_secure.content_keys values('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006');
        insert into vault.decrypted_secrets values('00000000-0000-4000-8000-000000000006','synthetic-benchmark-secret');
        select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',false);
    `)
    const initial = await migration("20260821150000_encrypted_communications.sql")
    const repaired = await migration("20260821230000_fix_communication_key_roundtrip.sql")
    const client = (await migration("20260909100000_client_delivery_teams.sql")).replaceAll("decrypted.secret", "decrypted.decrypted_secret")
    const native = await migration("20260908183000_native_message_quotes.sql")
    for (const [source, name] of [[initial, "public.native_conversation_can_read"], [client, "public.client_conversation_can_access"], [repaired, "communications_secure.try_decrypt_text"], [repaired, "communications_secure.try_decrypt_jsonb"], [client, "public.communication_client_message"], [client, "public.communication_client_messages"], [native, "public.communication_native_message"], [native, "public.communication_native_messages"]]) await db.exec(definition(source, name))
    await db.exec(await migration("20260910230000_bounded_communication_decoding.sql"))
    await db.exec(`
        with encrypted as materialized(select extensions.pgp_sym_encrypt(repeat('Synthetic body ',20),'synthetic-benchmark-secret') body,extensions.pgp_sym_encrypt('{"attachment":{"kind":"image","storagePath":"synthetic"}}','synthetic-benchmark-secret') payload)
        insert into client_messages(id,workspace_id,relationship_id,direction,provider,status,sender_kind,created_at,body_ciphertext,raw_payload_ciphertext,body_key_id)
        select md5('client-'||item)::uuid,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','inbound','meta_whatsapp','received','client',timestamptz '2026-01-01' + item * interval '1 second',encrypted.body,encrypted.payload,'00000000-0000-4000-8000-000000000005' from generate_series(1,6000) item cross join encrypted;
        with encrypted as materialized(select extensions.pgp_sym_encrypt(repeat('Synthetic body ',20),'synthetic-benchmark-secret') body,extensions.pgp_sym_encrypt('{"kind":"image","storagePath":"synthetic"}','synthetic-benchmark-secret') attachment,extensions.pgp_sym_encrypt('{"text":"Synthetic","start":0,"end":9}','synthetic-benchmark-secret') quote)
        insert into workspace_native_messages(id,workspace_id,conversation_id,sender_user_id,sender_workspace_role,created_at,body_ciphertext,attachment_ciphertext,quote_ciphertext,body_key_id)
        select md5('native-'||item)::uuid,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','staff',timestamptz '2026-01-01' + item * interval '1 second',encrypted.body,encrypted.attachment,encrypted.quote,'00000000-0000-4000-8000-000000000005' from generate_series(1,6000) item cross join encrypted;
        update client_messages set body_ciphertext='broken'::bytea where created_at > timestamptz '2026-01-01' + interval '5993 seconds';
        update workspace_native_messages set attachment_ciphertext='broken'::bytea where created_at > timestamptz '2026-01-01' + interval '5993 seconds';
        analyze;
    `)
    const scope = { client: "00000000-0000-4000-8000-000000000003", native: "00000000-0000-4000-8000-000000000004" }
    for (const kind of ["client", "native"]) for (const limit of [60, 500, kind === "client" ? 2000 : 4000]) {
        const initialBootstrap = limit >= 2000
        const results = []
        for (const suffix of ["", "_bounded"]) {
            const start = performance.now()
            const result = await db.query(`select jsonb_agg(to_jsonb(message) order by created_at desc,id desc) as rows from public.communication_${kind}_messages${suffix}($1,$2,$3) message`, ["00000000-0000-4000-8000-000000000001", initialBootstrap ? null : scope[kind], limit])
            results.push({ rows: result.rows[0].rows, durationMs: Math.round(performance.now() - start) })
        }
        if (JSON.stringify(results[0].rows) !== JSON.stringify(results[1].rows) || results[1].rows.length !== limit) throw new Error(`${kind} output parity failed`)
        console.log(JSON.stringify({ kind, storedRows: 6000, corruptNewestRows: 7, returnedRows: limit, initialBootstrap, oldMs: results[0].durationMs, boundedMs: results[1].durationMs, identicalContent: true }))
    }
    console.log(JSON.stringify({ result: "PASS: actual existing decoders and pgcrypto, identical valid message bodies/payloads/quotes; corrupt rows skipped", limitation: "Local WebAssembly timing, modeled JWT/Vault source. Not production latency or full-schema proof." }))
} catch (error) {
    console.error(JSON.stringify({ message: error.message, code: error.code, where: error.where }))
    process.exitCode = 1
} finally { await db.close() }
