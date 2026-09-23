import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectFoundationChanges, resolveFoundationBase } from "../scripts/check-foundation-changes.mjs";

const checker = fileURLToPath(new URL("../scripts/check-foundation-changes.mjs", import.meta.url));
const historical = "supabase/migrations/20260101000000_foundation.sql";
const fresh = "supabase/migrations/20260923180000_new_command.sql";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function put(cwd, path, contents) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), contents);
}

function fixture(t, extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "be-foundation-git-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Foundation fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  put(cwd, ".gitignore", "node_modules/\n");
  put(cwd, historical, "select 1;\n");
  put(cwd, "src/old.js", "export const old = 1;\n");
  for (const [path, contents] of Object.entries(extra)) put(cwd, path, contents);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Synthetic baseline");
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "update-ref", "refs/remotes/origin/main", base);
  return { cwd, base };
}

function check(cwd, base, ...args) {
  const result = spawnSync(process.execPath, [checker, "--base", base, "--json", ...args], { cwd, encoding: "utf8" });
  return { ...result, report: result.stdout.startsWith("{") ? JSON.parse(result.stdout) : null };
}

test("unchanged historical migrations pass, including existing legacy names and duplicates", (t) => {
  const { cwd, base } = fixture(t, { "supabase/migrations/20260101000000_legacy copy.sql": "select 2;\n" });
  const result = check(cwd, base);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.historicalMigrationCount, 2);
  assert.deepEqual(result.report.issues, []);
});

test("historical edits are refused both unstaged and committed", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, historical, "select 99;\n");
  assert.equal(check(cwd, base).status, 1);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Attempt historical edit");
  assert.match(check(cwd, base).report.issues.join("\n"), /Historical migration/);
});

test("historical deletion is refused in working tree and index", (t) => {
  const { cwd, base } = fixture(t);
  rmSync(join(cwd, historical));
  assert.match(check(cwd, base).report.issues.join("\n"), /Historical migration.*\(D\)/);
  git(cwd, "add", "-A");
  assert.equal(check(cwd, base).status, 1);
});

test("a staged historical edit hidden by restoring baseline working bytes is refused", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, historical, "select 99;\n");
  git(cwd, "add", historical);
  put(cwd, historical, "select 1;\n");
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /Partially staged candidate.*foundation\.sql/);
});

test("a staged deletion hidden by restoring the path as untracked is refused", (t) => {
  const { cwd, base } = fixture(t);
  git(cwd, "rm", "src/old.js");
  put(cwd, "src/old.js", "export const old = 1;\n");
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /Partially staged candidate.*old\.js/);
});

test("staged JS and whitespace cannot hide behind a different clean working copy", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, "src/old.js", "export const old = ;  \n");
  git(cwd, "add", "src/old.js");
  put(cwd, "src/old.js", "export const old = 1;\n");
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /Partially staged candidate.*old\.js/);
  git(cwd, "restore", "--staged", "src/old.js");
  assert.equal(check(cwd, base).status, 0, "unstaging removes the unverified commit candidate");
});

test("ordinary unstaged edits remain reviewable, and fully staged edits pass the same lint scope", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, "src/old.js", "export const old = 2;\n");
  const unstaged = check(cwd, base);
  assert.equal(unstaged.status, 0);
  assert.deepEqual(unstaged.report.lintFiles, ["src/old.js"]);
  git(cwd, "add", "src/old.js");
  const staged = check(cwd, base);
  assert.equal(staged.status, 0);
  assert.deepEqual(staged.report.lintFiles, unstaged.report.lintFiles);
  put(cwd, "src/old.js", "export const old = 3;\n");
  assert.equal(check(cwd, base).status, 1, "a partial staging state is refused");
  git(cwd, "add", "src/old.js");
  assert.equal(check(cwd, base).status, 0, "staging the complete reviewed file resolves the mismatch");
});

test("historical rename is refused even when the new filename is valid", (t) => {
  const { cwd, base } = fixture(t);
  git(cwd, "mv", historical, fresh);
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /Historical migration.*\(R100\)/);
});

test("new unreleased migration stays editable across staged, committed and untracked states", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, fresh, "select 2;\n");
  assert.equal(check(cwd, base).status, 0);
  git(cwd, "add", fresh);
  assert.equal(check(cwd, base).status, 0);
  git(cwd, "commit", "-m", "Add candidate migration");
  put(cwd, fresh, "select 3;\n");
  const result = check(cwd, base);
  assert.equal(result.status, 0);
  assert.deepEqual(result.report.newMigrations, [fresh]);
  assert.equal(check(cwd, "HEAD").status, 1, "the same file is historical against a newer base");
});

test("new migrations require valid lowercase names and real UTC timestamps", (t) => {
  const { cwd, base } = fixture(t);
  for (const filename of ["short.sql", "20260230000000_invalid_day.sql", "20260923240000_invalid_hour.sql", "20260923180000_Has Spaces.sql"]) {
    const path = `supabase/migrations/${filename}`;
    put(cwd, path, "select 1;\n");
    const result = check(cwd, base);
    assert.equal(result.status, 1, filename);
    assert.match(result.report.issues.join("\n"), /real UTC date/);
    rmSync(join(cwd, path));
  }
});

test("duplicate versions are refused against history and among new files", (t) => {
  const { cwd, base } = fixture(t);
  const duplicate = "supabase/migrations/20260101000000_collision.sql";
  put(cwd, duplicate, "select 2;\n");
  assert.match(check(cwd, base).report.issues.join("\n"), /New duplicate migration version 20260101000000/);
  rmSync(join(cwd, duplicate));
  put(cwd, fresh, "select 2;\n");
  put(cwd, "supabase/migrations/20260923180000_other_command.sql", "select 3;\n");
  assert.match(check(cwd, base).report.issues.join("\n"), /New duplicate migration version 20260923180000/);
});

test("new migration symlinks, including dangling links, are refused", (t) => {
  const { cwd, base } = fixture(t);
  symlinkSync("missing.sql", join(cwd, fresh));
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /regular file/);
});

test("changed JS/TS symlinks cannot silently bypass scoped lint", (t) => {
  const { cwd, base } = fixture(t);
  symlinkSync("old.js", join(cwd, "src/linked.js"));
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /JS\/TS source must be a regular file/);
});

test("invalid and shell-like base refs fail visibly without execution", (t) => {
  const { cwd } = fixture(t);
  for (const base of ["not-a-real-ref", "--help", "HEAD; touch injected", "$(touch injected)"]) {
    const result = check(cwd, base);
    assert.equal(result.status, 1, base);
    assert.equal(result.report, null);
    assert.ok(result.stderr.length > 0);
  }
  assert.throws(() => readFileSync(join(cwd, "injected")), { code: "ENOENT" });
});

test("NUL-safe change list preserves spaces, tabs, newlines and literal shell syntax", (t) => {
  const oldPath = "src/old name.ts";
  const { cwd, base } = fixture(t, { [oldPath]: "export const renamed = 1;\n" });
  const renamed = "src/new name.ts";
  renameSync(join(cwd, oldPath), join(cwd, renamed));
  git(cwd, "add", "-A");
  const added = ["src/space name.jsx", "src/tab\tname.mjs", "src/line\nbreak.ts", "src/$(touch injected).js"];
  for (const path of added) put(cwd, path, "export const value = 1;\n");
  rmSync(join(cwd, "src/old.js"));
  const result = check(cwd, base);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.report.lintFiles, [...added, renamed].sort());
});

test("whitespace is enforced for tracked and untracked files", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, "src/old.js", "export const old = 2;  \n");
  put(cwd, "new notes.md", "trailing space \n");
  const result = check(cwd, base);
  assert.equal(result.status, 1);
  assert.match(result.report.issues.join("\n"), /Tracked whitespace errors/);
  assert.match(result.report.issues.join("\n"), /Untracked whitespace errors/);
});

test("scoped lint receives exact argv, excludes deleted/unchanged files, and propagates nonzero status", (t) => {
  const { cwd, base } = fixture(t);
  const changed = ["src/space name.ts", "src/$(touch injected).js"];
  for (const path of changed) put(cwd, path, "export const value = 1;\n");
  const lintScript = "node_modules/eslint/bin/eslint.js";
  put(cwd, lintScript, "require('node:fs').writeFileSync('node_modules/lint-argv.json', JSON.stringify(process.argv.slice(2)));\n");
  const passed = check(cwd, base, "--lint");
  assert.equal(passed.status, 0, passed.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, "node_modules/lint-argv.json"), "utf8")), ["--max-warnings", "0", "--", ...changed.sort()]);
  for (const exit of [1, 2]) {
    put(cwd, lintScript, `process.exit(${exit});\n`);
    const failed = check(cwd, base, "--lint");
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, new RegExp(`Scoped ESLint exited ${exit}`));
  }
  assert.throws(() => readFileSync(join(cwd, "injected")), { code: "ENOENT" });
});

test("missing installed ESLint fails instead of silently skipping changed code", (t) => {
  const { cwd, base } = fixture(t);
  put(cwd, "src/new.js", "export const value = 1;\n");
  assert.match(check(cwd, base, "--lint").stderr, /Installed ESLint is missing/);
});

test("event bases cover pull requests, push history, initial push and manual branch/main runs", (t) => {
  const { cwd, base } = fixture(t);
  const baselineTree = git(cwd, "rev-parse", `${base}^{tree}`);
  assert.equal(resolveFoundationBase(cwd, "pull_request", { pull_request: { base: { sha: base } } }), baselineTree);
  assert.equal(resolveFoundationBase(cwd, "push", { before: base }), baselineTree);
  const empty = resolveFoundationBase(cwd, "push", { before: "0".repeat(40) });
  assert.equal(inspectFoundationChanges(cwd, empty).historicalMigrationCount, 0);
  assert.equal(resolveFoundationBase(cwd, "workflow_dispatch", {}), empty, "first commit has an empty base");
  put(cwd, "src/next.js", "export const next = 1;\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Branch work");
  assert.equal(resolveFoundationBase(cwd, "workflow_dispatch", {}), baselineTree, "branch uses merge base");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  assert.equal(resolveFoundationBase(cwd, "workflow_dispatch", {}), baselineTree, "main checks previous commit");
  assert.equal(resolveFoundationBase(cwd, "workflow_dispatch", {}, base), baselineTree);
  assert.throws(() => resolveFoundationBase(cwd, "pull_request", {}), /base SHA is missing/);
  assert.throws(() => resolveFoundationBase(cwd, "push", { before: "not-a-commit" }));
  assert.throws(() => resolveFoundationBase(cwd, "workflow_dispatch", {}, "--help"), /valid base/);
});
