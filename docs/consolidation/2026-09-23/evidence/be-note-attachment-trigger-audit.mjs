import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '/private/tmp/be-pglite-relationship-fixes/node_modules/@electric-sql/pglite/dist/index.js';

const sourcePath = '/private/tmp/betelgeze-platform-consolidation/supabase/migrations/20260918130000_workspace_notes.sql';
const originalMigration = await readFile(sourcePath, 'utf8');
const originalBody = originalMigration.match(/create or replace function public\.enforce_note_link_workspace\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
assert.ok(originalBody, 'Original trigger function must be present');
assert.equal(createHash('md5').update(originalBody).digest('hex'), '75cb6e5209f6c5d59aefb3ffcfefac5e', 'Verify exact original body confirmed by production metadata');
const db = new PGlite();
const results = [];
const ids = {
  workspaceA: '10000000-0000-4000-8000-000000000001',
  workspaceB: '10000000-0000-4000-8000-000000000002',
  noteA: '20000000-0000-4000-8000-000000000001',
  noteB: '20000000-0000-4000-8000-000000000002',
  relationshipA: '30000000-0000-4000-8000-000000000001',
  relationshipB: '30000000-0000-4000-8000-000000000002',
  assetA: '40000000-0000-4000-8000-000000000001',
  assetB: '40000000-0000-4000-8000-000000000002',
};
const record = (name, fields = {}) => { const entry = { name, ...fields }; results.push(entry); console.log(JSON.stringify(entry)); };
async function rejected(name, sql, values, expectedCode, expectedMessage) {
  try { await db.query(sql, values); assert.fail(`${name} unexpectedly succeeded`); }
  catch (error) {
    assert.equal(error.code, expectedCode, `${name}: code`);
    assert.match(error.message, expectedMessage, `${name}: message`);
    record(name, { passed: true, sqlstate: error.code, message: error.message });
  }
}
try {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
    CREATE TABLE public.relationships (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id));
    CREATE TABLE public.assets (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id));
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
    CREATE FUNCTION public.is_workspace_member(uuid, text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT false; $$;
  `);
  await db.exec(originalMigration);
  const version = (await db.query('SELECT version() AS version')).rows[0].version;
  const definitionHash = (await db.query("SELECT md5(prosrc) AS hash FROM pg_proc WHERE oid = 'public.enforce_note_link_workspace()'::regprocedure")).rows[0].hash;
  assert.equal(definitionHash, '75cb6e5209f6c5d59aefb3ffcfefac5e');
  record('environment', { version, sourcePath, originalFunctionBodyMd5: definitionHash, database: 'fresh in-memory PGlite; no live connection' });
  await db.query('INSERT INTO workspaces(id) VALUES ($1),($2)', [ids.workspaceA, ids.workspaceB]);
  await db.query("INSERT INTO notes(id,workspace_id,name,description) VALUES ($1,$2,'Fixture A','Fixture description A'),($3,$4,'Fixture B','Fixture description B')", [ids.noteA,ids.workspaceA,ids.noteB,ids.workspaceB]);
  await db.query('INSERT INTO relationships(id,workspace_id) VALUES ($1,$2),($3,$4)', [ids.relationshipA,ids.workspaceA,ids.relationshipB,ids.workspaceB]);
  await db.query('INSERT INTO assets(id,workspace_id) VALUES ($1,$2),($3,$4)', [ids.assetA,ids.workspaceA,ids.assetB,ids.workspaceB]);
  const relationInsert = 'INSERT INTO note_relationships(note_id,relationship_id,workspace_id) VALUES ($1,$2,$3)';
  const assetInsert = 'INSERT INTO note_assets(note_id,asset_id,workspace_id) VALUES ($1,$2,$3)';
  await rejected('original valid note-to-relationship fails', relationInsert, [ids.noteA,ids.relationshipA,ids.workspaceA], '42703', /record "new" has no field "asset_id"/);
  await rejected('original valid note-to-asset fails', assetInsert, [ids.noteA,ids.assetA,ids.workspaceA], '42703', /record "new" has no field "relationship_id"/);
  assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM note_relationships)::int AS relationships, (SELECT count(*) FROM note_assets)::int AS assets')).rows[0], { relationships: 0, assets: 0 });

  const proposedFunction = `CREATE OR REPLACE FUNCTION public.enforce_note_link_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.notes note
        WHERE note.id = NEW.note_id AND note.workspace_id = NEW.workspace_id
    ) THEN
        RAISE EXCEPTION 'Note does not belong to the link workspace';
    END IF;
    IF TG_TABLE_NAME = 'note_relationships' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.relationships relationship
            WHERE relationship.id = NEW.relationship_id AND relationship.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'Relationship does not belong to the link workspace';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'note_assets' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.assets asset
            WHERE asset.id = NEW.asset_id AND asset.workspace_id = NEW.workspace_id
        ) THEN
            RAISE EXCEPTION 'Asset does not belong to the link workspace';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;`;
  await db.exec(proposedFunction);
  await db.query(relationInsert, [ids.noteA,ids.relationshipA,ids.workspaceA]);
  record('branched valid note-to-relationship succeeds', { passed: true });
  await db.query(assetInsert, [ids.noteA,ids.assetA,ids.workspaceA]);
  record('branched valid note-to-asset succeeds', { passed: true });
  await rejected('branched relationship target from another workspace rejected', relationInsert, [ids.noteA,ids.relationshipB,ids.workspaceA], 'P0001', /Relationship does not belong to the link workspace/);
  await rejected('branched asset target from another workspace rejected', assetInsert, [ids.noteA,ids.assetB,ids.workspaceA], 'P0001', /Asset does not belong to the link workspace/);
  await rejected('branched foreign note on relationship link rejected', relationInsert, [ids.noteB,ids.relationshipA,ids.workspaceA], 'P0001', /Note does not belong to the link workspace/);
  await rejected('branched foreign note on asset link rejected', assetInsert, [ids.noteB,ids.assetA,ids.workspaceA], 'P0001', /Note does not belong to the link workspace/);
  await rejected('branched relationship cross-workspace update rejected', 'UPDATE note_relationships SET relationship_id=$1 WHERE note_id=$2', [ids.relationshipB,ids.noteA], 'P0001', /Relationship does not belong to the link workspace/);
  await rejected('branched asset cross-workspace update rejected', 'UPDATE note_assets SET asset_id=$1 WHERE note_id=$2', [ids.assetB,ids.noteA], 'P0001', /Asset does not belong to the link workspace/);
  await rejected('branched duplicate relationship remains unique', relationInsert, [ids.noteA,ids.relationshipA,ids.workspaceA], '23505', /duplicate key/);
  await rejected('branched duplicate asset remains unique', assetInsert, [ids.noteA,ids.assetA,ids.workspaceA], '23505', /duplicate key/);
  const finalCounts = (await db.query('SELECT (SELECT count(*) FROM notes)::int AS notes, (SELECT count(*) FROM relationships)::int AS relationship_records, (SELECT count(*) FROM assets)::int AS asset_records, (SELECT count(*) FROM note_relationships)::int AS relationship_links, (SELECT count(*) FROM note_assets)::int AS asset_links')).rows[0];
  assert.deepEqual(finalCounts, { notes: 2, relationship_records: 2, asset_records: 2, relationship_links: 1, asset_links: 1 });
  assert.equal((await db.query('SELECT relationship_id FROM note_relationships')).rows[0].relationship_id, ids.relationshipA);
  assert.equal((await db.query('SELECT asset_id FROM note_assets')).rows[0].asset_id, ids.assetA);
  record('all record counts and valid links preserved after rejection cases', { passed: true, finalCounts });
  await writeFile('/private/tmp/be-note-attachment-trigger-audit-result.json', JSON.stringify({ verifiedAt: new Date().toISOString(), results, proposedFunction }, null, 2) + '\n');
  record('complete', { checks: 13, passed: true, artifact: '/private/tmp/be-note-attachment-trigger-audit-result.json' });
} finally { await db.close(); }
