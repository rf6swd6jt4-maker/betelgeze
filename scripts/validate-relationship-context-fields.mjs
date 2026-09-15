import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from './pglite-fixture.mjs'
const db = new PGlite()
await db.exec(`create role service_role bypassrls; create role anon; create role authenticated;
create schema auth; create table auth.users(id uuid primary key);
create table workspaces(id uuid primary key,status text default 'active');
create table relationships(id uuid primary key,workspace_id uuid, primary_person_name text,business_name text,primary_contact_role text,primary_phone text,whatsapp_phone text,communication_primary_provider text,communication_delivery_mode text,primary_email text,notes_summary text,location_value text,industry_value text,website_url text,seller_user_id uuid,fulfilment_manager_user_id uuid,pos_started_at timestamptz,updated_at timestamptz default now(),unique(workspace_id,id));
create function workspace_user_can_access_relationship(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
create function workspace_role_for_user(uuid,uuid) returns text language sql as $$select 'owner'::text$$;`)
await db.exec(await readFile(new URL('../supabase/migrations/20260910220000_relationship_background_command_receipts.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260915210000_relationship_context_fields.sql',import.meta.url),'utf8'))
const id='00000000-0000-4000-8000-000000000001'
await db.exec(`insert into auth.users values('${id}');insert into workspaces(id) values('${id}');insert into relationships(id,workspace_id,industry_value,website_url) values('${id}','${id}','old','old.example');grant all on all tables in schema public to service_role;set role service_role;`)
const values={primaryPersonName:'Client',businessName:'Business',primaryContactRole:'',primaryPhone:'',whatsappPhone:'',communicationPrimaryProvider:'twilio_sms',communicationDeliveryMode:'primary_only',primaryEmail:'',description:''}
const version=async()=>(await db.query('select updated_at::text as v from relationships')).rows[0].v
const send=async(v,n)=>(await db.query('select save_relationship_background_command($1,$1,$1,$2,$3,$4,$5) as r',[id,await version(),`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,'a'.repeat(64),JSON.stringify(v)])).rows[0].r
assert.equal((await send(values,2)).values.industryValue,'old')
const result=await send({...values,industryValue:'SEO',websiteUrl:'https://example.com',locationValue:'Dublin'},3)
assert.equal(result.ok,true);assert.equal(result.values.industryValue,'SEO');assert.equal(result.values.websiteUrl,'https://example.com')
assert.equal((await send({...values,industryValue:'',websiteUrl:''},4)).values.websiteUrl,'')
console.log('PASS: legacy saves preserve context; new saves persist and clear both fields')
await db.close()
