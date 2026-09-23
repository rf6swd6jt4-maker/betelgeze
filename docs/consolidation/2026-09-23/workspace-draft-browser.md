# Mounted workspace draft recovery fixture

[serve-workspace-draft-fixture.mjs](../../../scripts/serve-workspace-draft-fixture.mjs) builds a loopback-only fixture with the installed React 19/ReactDOM and webpack. It transpiles and mounts the complete current `useWorkItemTextDraft`, `WorkItemTextField`, `WorkspaceAutosaveForm`, `WorkspaceDraftRecovery`, draft journal, mutation registry and record-version helper. It does not substitute a recreated editor or journal algorithm.

Router refresh, Gantt publication and presentation primitives are explicit mocks. The dialog uses a real React portal, and editors, events, FormData and localStorage use the browser runtime. Save callbacks are controlled promises containing synthetic values. Production and development bundles use identical application source; the development bundle enables actual StrictMode effect replay. Full authenticated routes, Next hydration, real server commands and the complete application design system are outside this fixture.

```sh
node scripts/serve-workspace-draft-fixture.mjs
node scripts/serve-workspace-draft-fixture.mjs --development
```

Each server prints its loopback URL, bundle directory and SHA-256 source manifest. Open `/` and press **Run regression checks**, or open `/?autorun`. Each run gets unique synthetic actor/record scopes. Cleanup removes only that run's synthetic storage entries and mounted React owners. Each case has bounded condition waits and a 6.5-second action deadline; a deadline stops remaining cases and names them as missing. Browser suspension can delay timers themselves, so no foreground responsiveness or paint timing is inferred from case duration.

Completed results are visible in the page and posted to the same-origin `/results` endpoint. The server rejects other origins, non-JSON requests, oversized bodies, excessive cases and a mismatched source manifest. It saves the complete JSON to its temporary bundle directory. The fixture blocks and records every attempted browser fetch except this result POST. There are no real credentials, provider calls, application servers or client records.

## Cases and assertions

The fixture has 25 cases. Both actual owners exercise these 11 scenarios:

- Ordinary input performs zero localStorage writes before an explicit checkpoint; four inputs do not immediately submit a request.
- An in-flight save followed by late input and owner unmount retains the late copy; the old acknowledgement cannot trigger another save or publish a saved callback. Remount displays current server text and leaves recovery explicit.
- Recovery displays current/saved text, restores only on **Use this draft**, and blocks ordinary flush/debounce until **Save reviewed draft**.
- Recovery selected during an older pending request remains gated after that request's acknowledgement.
- A simulated quota exception refuses durable checkpoint success, reports the failure, and leaves an explicitly recoverable copy in the current document.
- Simulated unavailable storage is disclosed during review; the retained copy is labeled **Open page only**.
- Actor/workspace replacement preserves the old actor's draft, isolates the new scope and rejects stale acknowledgement effects.
- An unspecified account-clearing event closes recovery and stops pending/continued saves.
- A matching `preservedUserId` account event leaves the current owner's dialog and save ability active.
- A different `preservedUserId` closes/stops the displaced owner while preserving its draft.
- A synthetic `pagehide` event checkpoints dirty text without initiating a server save.

The remaining three cases exercise text conflict preservation and explicit use-latest archiving, rejected form-save retention and retry, and a direct hook prop-only identity switch while old and new saves are pending. The regular actor-switch case also mirrors the keyed owner boundary used by the current record pages.

Storage-call observations are precise to the fixture. A new durable checkpoint can write both an availability hint and a payload; zero typing writes does not mean every departure is a single storage API call. Quota/security failures are injected into actual Storage methods, not established by filling the browser's physical quota. Document-retained copies do not establish recovery after closing or killing that document. Synthetic `pagehide` is not a real process-termination test.

## Evidence

Script syntax and strict scoped lint passed. The parent agent ran the browser through CUA; complete local result JSON is preserved separately for each runtime:

| Browser/runtime | Result | Evidence |
| --- | --- | --- |
| Chromium 153, production React 19.2.4 | 25/25; zero failed or missing cases; zero unexpected fetches | [Production result](./evidence/workspace-draft-chromium-production.json) |
| Chromium 153, development React 19.2.4 with StrictMode | 25/25; zero failed or missing cases; zero unexpected fetches | [Development result](./evidence/workspace-draft-chromium-development.json) |
| Safari, corrected production harness | Incomplete; no completed result JSON and no final Safari pass claim | [Final Safari observation](./evidence/workspace-draft-final-safari-observation.md) |

Both Chromium reports show zero typing writes for both owners, and the unavailable-storage cases each record one denied enumeration with a visible warning. All seven application source hashes match between the initial and corrected harness runs and the frozen workspace. These are mounted runtime regressions, not an authenticated application, physical-device or production speed claim. Parent integration validation also reported 1,353/1,353 tests, strict lint over 99 changed JS/TS files, and a successful webpack build; those checks are separate from browser evidence.

The final Safari attempt was observed at case 3 before native automation reported a different, user-owned foreground window. No completed Safari JSON existed at the final check. The attempt was stopped without interacting with that window. Foreground ownership and uninterrupted execution were not established, so incomplete progress is not attributed to an application defect. Both fixture servers were stopped; raw bundles and reports remain in their temporary directories.

The superseded [initial Chromium run](./evidence/workspace-draft-initial-chromium.json) completed 23/25. Both failures exposed a harness problem: inaccessible-storage injection denied `getItem`/`setItem`, but an empty readable `length` meant recovery never attempted a denied read. The corrected harness also denies enumeration and explicitly asserts the injected failure occurred; the warning requirement was retained. Application source is identical. The [initial Safari observation](./evidence/workspace-draft-initial-safari-observation.md) was incomplete at case 4/25 and produced no result JSON; its cause is unverified. The corrected case deadline covers mounting as well as the action, but cannot run while the browser engine itself is suspended.

The frozen runtime snapshot includes these SHA-256 hashes:

| Source | SHA-256 |
| --- | --- |
| `useWorkItemTextDraft.ts` | `e5fb9a50aa2c68300998f154ed034ac0887a8a7ada02cb09be300bc5af694994` |
| `WorkspaceAutosaveForm.tsx` | `4e716011e98438c91af5da0bcd9b4f275864023578dfa522adcee06daf7f01ad` |
| `WorkspaceDraftRecovery.tsx` | `9c15b4d152f954a48a14e9eadf124fd8cd27d7230363f98fcca20a73b1ecd005` |
| `workspace-draft-journal.ts` | `a178980de4dd5faf251d6deefc2beefec1ec93050a21d253ba93e62e0253bca4` |

The final fixture script SHA-256 is `4249a7eb3a3e9296698008b4b26ef351f50b684aeecf49d547bee64760c86c4c`.

Every result also records all seven source hashes, React version, user agent, build mode, visibility/focus at completion, failures and missing cases. Chromium and Safari results remain separate evidence; neither is Android or iOS physical-device proof.
