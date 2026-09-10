import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.argv[2] ?? join(tmpdir(), 'be-performance-rollout-validation.sql')
const migrations = [
 '20260910130000_workspace_interaction_metrics.sql',
 '20260910150000_appointment_draft_command_receipts.sql',
 '20260910200000_communication_history_pages.sql',
 '20260910210000_appointment_notification_outbox.sql',
 '20260910220000_relationship_background_command_receipts.sql',
 '20260910230000_bounded_communication_decoding.sql',
]
const read = (name) => readFile(join(root, name), 'utf8')
const withoutTransactions = (sql) => sql.replace(/^\s*(?:begin|commit|rollback);\s*$/gmi, '')
const sections = [
 '-- Reviewed rollback-only validation. Run the catalog prerequisite query first.\n-- Only synthetic fixture records are read or written; no provider calls or helper replacements.\n-- DDL takes ordinary table locks; fail quickly instead of waiting behind live work.\nBEGIN;\nSET LOCAL lock_timeout = \'1s\';\nSET LOCAL statement_timeout = \'45s\';\nSET LOCAL idle_in_transaction_session_timeout = \'60s\';',
]
for (const migration of migrations) sections.push(`-- Migration: ${migration}\n${withoutTransactions(await read(`supabase/migrations/${migration}`))}`)
sections.push(await read('tests/sql/performance-rollout-fixture.sql'))
for (const test of ['appointment-draft-command', 'appointment-notification-outbox', 'relationship-background-command']) {
 let sql = withoutTransactions(await read(`tests/sql/${test}.sql`))
 sql = sql.replace(/^select true as \w+;\s*$/gm, '')
 if (test === 'appointment-draft-command') {
  sql = sql.replace(/select rs\.workspace_id, rs\.relationship_id, rs\.service_id into strict scope[\s\S]*?limit 1;/, 'select workspace_id, relationship_id, service_id into strict scope from pg_temp.performance_rollout_fixture;')
 } else if (test === 'appointment-notification-outbox') {
  sql = sql.replace(/select rs\.workspace_id, rs\.relationship_id, rs\.service_id into strict scope[\s\S]*?limit 1;/, 'select workspace_id, relationship_id, service_id into strict scope from pg_temp.performance_rollout_fixture;')
 } else {
  sql = sql.replace(/select r\.\* into strict row from public\.relationships r join public\.workspace_memberships m on m\.workspace_id=r\.workspace_id and m\.role='owner' limit 1;/, 'select r.* into strict row from public.relationships r where r.id=(select relationship_id from pg_temp.performance_rollout_fixture);')
 }
 if (sql.includes('limit 1;') && /from public\.relationship_services rs/.test(sql)) throw new Error(`Unscoped fixture selection remains in ${test}`)
 sections.push(`-- Scoped regression suite: ${test}\n${sql}\nRESET ROLE;`)
}
sections.push(await read('tests/sql/performance-rollout-contracts.sql'))
sections.push(await read('tests/sql/bounded-communication-decoding.sql'))
sections.push('RESET ROLE;\nROLLBACK;\nSELECT \'PASS: performance command migrations, real permission/trigger/encryption contracts and rollback checks\' AS result;')
const sql = sections.join('\n\n')
if (/^\s*commit;/mi.test(sql) || (sql.match(/^ROLLBACK;/gm) ?? []).length !== 1) throw new Error('Validation must contain exactly one outer rollback and no commit')
await writeFile(output, sql)
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex'), migrations }))
