// Read-only reproduction against current main 31388081894e6d4143d5bb0d577c0341ec31edf7.
// Uses the repository's existing motion fixture, extending show() only in memory.
// No DOM browser, provider, database, app-file write, or production operation occurs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
const worktree = '/private/tmp/betelgeze-platform-consolidation';
const { observeChatViewportMotion, requestChatViewportMotion } = await import(pathToFileURL(`${worktree}/lib/chat-viewport-motion.ts`).href);
const testSource = readFileSync(`${worktree}/tests/chat-viewport-motion.test.ts`, 'utf8');
let fixtureSource = testSource.slice(testSource.indexOf('function fixture('), testSource.indexOf('\ntest('));
assert.ok(fixtureSource.includes('hide: () => { visible = false }'), 'Existing fixture shape must match audited baseline.');
fixtureSource = fixtureSource.replace('hide: () => { visible = false }', 'hide: () => { visible = false }, show: () => { visible = true }');
const fixture = new Function('observeChatViewportMotion', 'requestChatViewportMotion', stripTypeScriptTypes(fixtureSource) + '\nreturn fixture;')(observeChatViewportMotion, requestChatViewportMotion);
const f = fixture(true);
try {
  f.move(500); f.touch('touchstart'); f.advance(0.5);
  f.hide(); f.move(800);
  f.show(); f.move(500); f.advance(1); f.settle(); f.settle();
  const observed = { applied: f.applied(), visualBottom: f.bottom(), layerHeight: f.layer.style.height, moving: f.clip.dataset.chatViewportMoving ?? null, willChange: f.layer.style.willChange };
  const expected = { applied: 500, visualBottom: 500, layerHeight: '', moving: null, willChange: '' };
  const reproduced = JSON.stringify(observed) !== JSON.stringify(expected);
  console.log(JSON.stringify({ baselineCommit: '31388081894e6d4143d5bb0d577c0341ec31edf7', evidenceKind: 'synthetic helper fixture; no physical-device claim', scenario: 'interrupted touch; resident frame hidden and shown; next keyboard opening', expected, observed, defectReproduced: reproduced }, null, 2));
  assert.deepEqual(observed, expected, 'Hidden-frame retirement must clear stale gesture state so the next keyboard motion commits.');
} finally { f.cleanup(); }
