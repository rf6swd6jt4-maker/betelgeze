# Local v7: empty chats and interrupted actions

Local candidate only. User requested small and rare UI defects be found and
patched after testing v6. No deployment or production-data work is included.

## Reproduced defects and patches

1. **Empty prompt disappears, then jumps back.** Actual Team and Client fixtures
   reproduced a 320px completion jump: the top-aligned prompt was translated
   with bottom-anchored messages. With no messages, the existing motion owner
   now animates only the composer slot. The prompt stays in natural layout.
   Filled conversations retain the shared messages/composer motion, curve,
   retarget deadline and native scrolling handoff.
2. **Empty chat invents scrollable history on short screens.** A fixed 256px
   minimum prompt height produced 135px overflow in a 300px viewport and could
   clip its text above the pane. Empty content is now bounded by the real pane.
   Copy, fonts and the normal-screen prompt position are retained.
3. **Late edit acknowledgement overwrites a newer draft.** Cancel a delayed edit,
   type a new draft and let the old response arrive: v6 restored its old draft.
   A UI session token now gates draft/error/pending-state restoration. Cancel,
   selection and deleting the edit target invalidate that token. The original
   mutation and refresh still complete through their existing owners. Both late
   success and failure, A→B→A and a newer pending edit are covered.
4. **Sticker tray leaks into another Team chat.** Selecting or leaving a Team
   conversation now resets its transient tray, matching Client behaviour.
5. **A popup opens over a moving anchor.** The anchor drifted 113px after opening
   during a keyboard-close tween. AnchoredPopup emits a synchronous event from
   its anchor before measuring; the containing chat retires cosmetic motion
   first. Held-touch handling preserves native gesture ownership and records
   zero scroll writes. No body-wide mutation observer or frame loop is added.
6. **Reduce Motion changes are ignored mid-navigation.** Enabling the preference
   now finishes only the current entrance/exit. Listener cleanup and stale
   navigation callback guards remain in place.
7. **First/last message changes during a held touch retain the wrong animation.**
   First arrival during composer-only motion separated the row from the composer
   by 119px; final-row removal kept translating the new empty prompt. A content
   mode change now retires the old cosmetic target even during a hold, using the
   existing native scroll guards. It does not replace the reading owner or
   manufacture pointer/read events.

The empty-chat regression tests also cover first-message insertion, final-row
removal, repeated opening/closing, rapid reversals, draft growth and accessory
removal. Action tests additionally cover target deletion while menus/quotes are
open, rotated custom emoji menus, rapid gallery close/Back and draft retention.
Passing cases are coverage, not claims that each required a new product patch.

## Ownership, speed and scope

Composer focus, pointer selection, ComposerFooter sizing, viewport calculations,
header positioning and protected read predicates/hooks are unchanged. There is
still one cosmetic animation per chat, one message scroll owner and no new data
request, subscription, per-message observer, polling or JavaScript frame loop.
New UI session checks are constant-time. The popup event is synchronous and
local to its anchor ancestry; the extra preference listener exists only while
the conversation owns navigation.

Preview-only additions provide an empty Client conversation and a synthetic
event injector into the existing registered callbacks. These are for UI checks,
not a replacement transport or evidence of production synchronization.
Synthetic conversations also use distinct latest-message timestamps in their
display order. Previously every sample tied at exactly the same timestamp,
causing the first normal reconciliation to reorder the fixture list alphabetically.
This fixture correction changes no production sorting or synchronization policy.

## Local review

Open `http://192.168.0.108:3107/?v=7` on the Mac's Wi-Fi and confirm **Local v7**.
Use **New project** under Team or **New client** under Clients for empty states.
Open/close the keyboard, grow a draft and open/close stickers; then send a local
sample. Team samples can be deleted to return to empty. Other conversations
remain available for reactions, quotes, edit cancellation and media checks.
The optional content-free recorder identifies the build as `comms-edges-v7`.

Physical iPhone Safari/Home Screen and Android Chrome/installed-mode behaviour
remain separate from synthetic Chromium/WebKit observations. This local HTTP
preview does not establish secure installed-PWA or provider-delivery parity.
Deployment and the requested later synchronization work follow user acceptance.

## Evidence

Before/after lifecycle reports: `lifecycle-edge-before.json` and
`lifecycle-edge-after.json` under `/private/tmp/mobile-comms-displacement/`.
The empty baseline is `browser-results/fullscreen-comms-edges-baseline.json`;
its prompt and short-pane failures reproduce the defects above. Its first-row
selector was subsequently corrected and is not evidence of a product defect.

- Repository tests: 1,324/1,324 passed.
- Broad foundation run: 221/221 per engine. The final target-handoff change was
  subsequently verified by the complete motion suite, increasing it from 31 to
  33 cases per engine (the combined matrix now contains 223 cases).
- Final motion suite: 33/33 Chromium and 33/33 WebKit, zero page errors. First
  arrival retains a 20px message/composer gap; restored empty prompt remains at
  y=76 in the minimal fixture, with zero scroll writes during held touch. Removing
  only the target guard makes both new cases fail in both engines. Source hash
  matched throughout: `f6ab3e3ed4afd50f21da2616fd689db97e0e4083e3268ac0f9ad76f776e4bbe8`.
- Actual component checks in each engine: 12/12 empty/short-chat cases, 16/16
  interrupted-action cases and 20/20 routine actions. No external requests or
  page errors. These are synthetic response/viewport checks, not transport proof.
- Final production `next build --webpack` passed with synthetic environment
  values. Scoped lint, `git diff --check` and protected v6 file hashes passed.
- Desktop preview visibly rendered Local v7 and the empty New project chat with
  its existing styling. This is not physical-device confirmation.

Final reports: `browser-results/foundations.json`,
`browser-results/fullscreen-comms-edges.json`,
`browser-results/comms-action-edges.json`,
`browser-results/fullscreen-comms-actions.json`, and
`/private/tmp/mobile-comms-displacement/empty-target-handoff-final.json`.
`v7-build-final.log`, `v7-unit.log`, `v7-lint.log`, `v7-final-lint.log` and
`v7-validation.json` in that diagnostics directory retain this pass's evidence.
