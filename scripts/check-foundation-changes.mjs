#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectory = "supabase/migrations/";
const scriptExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function run(command, args, options = {}) {
  const { allowed = [0], ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) {
    throw new Error(`${command} exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function git(cwd, args, options) {
  return run("git", args, { cwd, ...options });
}

function splitNul(value) {
  return value.split("\0").filter(Boolean);
}

function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function resolveTree(cwd, ref) {
  if (!ref || ref.startsWith("-") || /[\r\n\0]/.test(ref)) {
    throw new Error("An explicit valid base ref is required.");
  }
  return git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{tree}`]).stdout.trim();
}

function emptyTree(cwd) {
  return git(cwd, ["hash-object", "-w", "-t", "tree", "--stdin"], { input: "" }).stdout.trim();
}

function previousCommitOrEmptyTree(cwd) {
  const previous = git(cwd, ["rev-parse", "--verify", "HEAD^"], { allowed: [0, 128] });
  return previous.status === 0 ? previous.stdout.trim() : emptyTree(cwd);
}

// Event fields are data passed to Git as argv, never interpolated into shell code.
export function resolveFoundationBase(cwd, eventName, event, manualBase = "") {
  let ref;
  if (eventName === "pull_request") {
    ref = event.pull_request?.base?.sha;
    if (!ref) throw new Error("Pull request base SHA is missing.");
  } else if (eventName === "push") {
    if (!event.before) throw new Error("Push before SHA is missing.");
    // Candidate branches must check their entire change against main on every
    // push. A first branch push has a zero before SHA, but existing migrations
    // are still history; subsequent pushes cannot hide an earlier violation.
    ref = event.ref?.startsWith("refs/heads/codex/")
      ? git(cwd, ["merge-base", "HEAD", "refs/remotes/origin/main"]).stdout.trim()
      : /^0+$/.test(event.before) ? emptyTree(cwd) : event.before;
  } else if (eventName === "workflow_dispatch") {
    if (manualBase.trim()) {
      ref = manualBase.trim();
    } else {
      const head = git(cwd, ["rev-parse", "HEAD"]).stdout.trim();
      const common = git(cwd, ["merge-base", "HEAD", "refs/remotes/origin/main"]).stdout.trim();
      ref = common === head ? previousCommitOrEmptyTree(cwd) : common;
    }
  } else {
    throw new Error(`Unsupported event: ${eventName}`);
  }
  // Return an immutable tree ID so branch movement cannot change the checked base.
  return resolveTree(cwd, ref);
}

function parseChanges(output) {
  const parts = splitNul(output);
  const changes = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++];
    const first = parts[index++];
    if (!first) throw new Error("Incomplete Git change entry.");
    if (status.startsWith("R") || status.startsWith("C")) {
      const second = parts[index++];
      if (!second) throw new Error("Incomplete Git rename/copy entry.");
      changes.push({ status, from: first, path: second });
    } else {
      changes.push({ status, path: first });
    }
  }
  return changes;
}

function validMigrationName(path) {
  const filename = path.slice(migrationDirectory.length);
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.exec(filename);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === iso;
}

export function inspectFoundationChanges(cwd, baseRef) {
  const base = resolveTree(cwd, baseRef);
  const baselineMigrations = new Set(splitNul(git(cwd, [
    "ls-tree", "-r", "--name-only", "-z", base, "--", migrationDirectory,
  ]).stdout));
  const changes = parseChanges(git(cwd, [
    "diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", base, "--",
  ]).stdout);
  const untracked = splitNul(git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]).stdout);
  const issues = [];
  // Lint/build inspect working files. Refuse partially staged paths so the index
  // cannot contain different, unverified bytes that a subsequent commit saves.
  // Entirely unstaged edits remain reviewable: there is no staged replacement.
  const stagedChanges = parseChanges(git(cwd, [
    "diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", "--",
  ]).stdout);
  const stagedPaths = new Set(stagedChanges.flatMap((change) => [change.from, change.path].filter(Boolean)));
  const unstagedChanges = parseChanges(git(cwd, [
    "diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", "--",
  ]).stdout);
  const differingPaths = new Set([
    ...unstagedChanges.flatMap((change) => [change.from, change.path].filter(Boolean)),
    // A staged deletion followed by restoring the path is now untracked.
    ...untracked,
  ]);
  for (const path of [...stagedPaths].filter((path) => differingPaths.has(path)).sort()) {
    issues.push(`Partially staged candidate differs between index and working tree: ${JSON.stringify(path)}. Stage the complete reviewed file or unstage it before running this gate.`);
  }
  for (const change of changes) {
    const historical = [change.from, change.path].filter((path) => baselineMigrations.has(path));
    for (const path of historical) {
      issues.push(`Historical migration cannot be modified, deleted or renamed: ${JSON.stringify(path)} (${change.status}). Add a new migration.`);
    }
  }

  const currentMigrations = [...new Set(splitNul(git(cwd, [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", migrationDirectory,
  ]).stdout))].filter((path) => statIfPresent(resolve(cwd, path)));
  const newMigrations = currentMigrations.filter((path) => !baselineMigrations.has(path));
  const versions = new Map();
  for (const path of currentMigrations) {
    const version = /^(\d{14})_/.exec(path.slice(migrationDirectory.length))?.[1];
    if (version) versions.set(version, [...(versions.get(version) || []), path]);
  }
  for (const path of newMigrations) {
    if (!lstatSync(resolve(cwd, path)).isFile() || !validMigrationName(path)) {
      issues.push(`New migration must be a regular file named YYYYMMDDHHMMSS_lowercase_description.sql with a real UTC date: ${JSON.stringify(path)}.`);
    }
  }
  for (const [version, paths] of versions) {
    if (paths.length > 1 && paths.some((path) => !baselineMigrations.has(path))) {
      issues.push(`New duplicate migration version ${version}: ${paths.map((path) => JSON.stringify(path)).join(", ")}.`);
    }
  }

  const whitespace = git(cwd, ["-c", "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab", "diff", "--no-ext-diff", "--no-textconv", "--check", base, "--"], { allowed: [0, 2] });
  if (whitespace.status !== 0) issues.push(`Tracked whitespace errors:\n${whitespace.stdout}${whitespace.stderr}`);
  for (const path of untracked) {
    const checked = git(cwd, ["-c", "core.whitespace=blank-at-eol,blank-at-eof,space-before-tab", "diff", "--no-ext-diff", "--no-textconv", "--no-index", "--check", "--", "/dev/null", path], { allowed: [0, 1, 2, 3] });
    // --no-index implies --exit-code: whitespace (2) can combine with difference (1).
    if (checked.stdout || checked.stderr || checked.status >= 2) {
      issues.push(`Untracked whitespace errors in ${JSON.stringify(path)}:\n${checked.stdout}${checked.stderr}`);
    }
  }
  const presentFiles = [...new Set([...changes.map((change) => change.path), ...untracked])]
    .filter((path) => statIfPresent(resolve(cwd, path)))
    .sort();
  for (const path of presentFiles) {
    if (scriptExtension.test(path) && !lstatSync(resolve(cwd, path)).isFile()) {
      issues.push(`Changed JS/TS source must be a regular file for scoped lint: ${JSON.stringify(path)}.`);
    }
  }
  const changedFiles = presentFiles.filter((path) => lstatSync(resolve(cwd, path)).isFile());
  return {
    base,
    historicalMigrationCount: baselineMigrations.size,
    newMigrations: newMigrations.sort(),
    changedFiles,
    lintFiles: changedFiles.filter((path) => scriptExtension.test(path)),
    issues,
  };
}

export function lintFoundationChanges(cwd, files) {
  if (files.length === 0) return;
  const eslint = resolve(cwd, "node_modules/eslint/bin/eslint.js");
  if (!existsSync(eslint)) throw new Error("Installed ESLint is missing; run npm ci before --lint.");
  // Keep argv well below platform limits; -- terminates flags even for unusual paths.
  for (let start = 0; start < files.length; start += 100) {
    const checked = run(process.execPath, [eslint, "--max-warnings", "0", "--", ...files.slice(start, start + 100)], { cwd, allowed: [0, 1, 2] });
    if (checked.stdout) process.stdout.write(checked.stdout);
    if (checked.stderr) process.stderr.write(checked.stderr);
    if (checked.status !== 0) throw new Error(`Scoped ESLint exited ${checked.status}.`);
  }
}

function main(args) {
  let base;
  let lint = false;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--base" && !base) base = args[++index];
    else if (args[index] === "--lint") lint = true;
    else if (args[index] === "--json") json = true;
    else throw new Error("Usage: node scripts/check-foundation-changes.mjs --base <ref> [--lint] [--json]");
  }
  const cwd = git(process.cwd(), ["rev-parse", "--show-toplevel"]).stdout.trim();
  const result = inspectFoundationChanges(cwd, base);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Foundation base tree: ${result.base}; ${result.historicalMigrationCount} historical migrations; ${result.newMigrations.length} new migrations; ${result.lintFiles.length} changed JS/TS files.`);
    for (const issue of result.issues) console.error(issue);
  }
  if (result.issues.length > 0) process.exitCode = 1;
  else if (lint) lintFoundationChanges(cwd, result.lintFiles);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
