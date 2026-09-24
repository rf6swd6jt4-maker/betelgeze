# Mobile Comms full-screen local candidate

Status: local review candidate, 24 September 2026. No production deployment. User approval is required before deployment. Base application: `fa7c677c8de41d471814a3dbec5fab97eeb7861d`.

The original candidate below failed the user's physical keyboard test. The current local revision and granular investigation are in [mobile-comms-displacement-local-v2.md](mobile-comms-displacement-local-v2.md). Use `/?v=2` and confirm the `Local v2` label; do not treat this original browser validation as a phone pass.

## Local access

- Phone on the Mac's Wi-Fi network: **http://192.168.0.108:3107/**
- This Mac: **http://localhost:3107/**
- Keep the preview process running and the Mac awake. The LAN address can change; restarting `node scripts/serve-fullscreen-comms-preview.mjs` prints the current address.

The exact LAN URL returned HTTP 200 during the final handoff check.

The preview uses synthetic conversations with the actual Team/Client workspaces, chat lists, message bubbles, CodeMirror composer, actions, media components and compiled application CSS. Its surrounding shell is a simplified local header/tab implementation with retained Comms/Work tabs. It exercises the shared viewport observer and handoff event, but is not the authenticated production shell/bootstrap.

Sample sends/edits remain in browser memory and reset on reload. Drafts use the existing draft owner under this local origin. Attachments stay local; no Supabase, provider or production messaging connection is included. Unsupported account/provider actions return local errors. There is no service worker. LAN HTTP does not establish secure installed-PWA parity.

## Implemented structure

The chat list remains mounted beneath a separate, opaque body-level conversation surface. Opening slides that surface from the right; its own header, messages and existing composer occupy the full usable height. The chevron dismisses the keyboard when necessary, slides the conversation out, then clears selection through the existing owner.

One stable portal target preserves the editor while moving between the desktop grid and mobile body. Navigation transforms are removed after entry. While the conversation owns measured visual-viewport geometry, workspace controllers suspend, underlying chrome/list become inert, and their paint is hidden during the fully open state. Closing restores their previous accessibility state and viewport ownership. Narrow legacy iframe views retain the inline path.

Existing conversation data, draft, upload, authorization, reading and alert owners remain in place. Gallery and Team dialogs travel with the surface; global profile dialogs remain accessible above it.

## Checks and evidence boundaries

| Check | Result |
| --- | --- |
| Repository unit suite | 1,311 passed |
| Focused viewport/handoff tests | 7 passed; included above |
| Scoped lint and `git diff --check` | Passed |
| Existing Chromium foundation fixtures | 148/148 passed |
| Existing WebKit foundation fixtures | 148/148 passed |
| Production webpack build | Final exact-source build passed, exit 0, with placeholder environment |
| Manual local browser at 390 × 844 | Full surface at x=0/y=0, width=390/height=844; open phase, transform removed, underlying chrome hidden; retained list height 744; multiline draft survived Back/reopen |

Browser counts come from `/private/tmp/betelgeze-fullscreen-browser.log`: per engine, mobile Comms 17, landscape 1, native host 6, native runtime 4, visual origin 6, departure 32, drafts 25, strict drafts 25, motion 5, mobile layout 24, reduced-motion layout 2 and desktop layout 1. These are existing synthetic foundation checks, not proof of the new slide transition or physical keyboard behavior. Manual browser observations are desktop checks at a mobile viewport, not phone evidence. The final build log is `/private/tmp/betelgeze-fullscreen-build-final.log`; it establishes compilation, not authentication or production-service readiness.

## Unresolved before release

**Read-acknowledgement recheck risk:** the existing reader can perform its initial visibility check while the entering surface is inert. Clearing inert at animation completion does not reliably trigger another read check; acknowledgement may wait for another interaction or state change. This remains unresolved. Automatic approval review rejected the proposed read-active gating change because it affected protected reading behavior. The protected hooks and their active conditions remain unchanged; the rejected change was not retried.

Physical iPhone Safari, Android Chrome and installed-PWA behavior remain unverified. Keyboard/long-press smoothness, transition coverage, back with the keyboard open, drafts, attachments, media and orientation require device acceptance. No claim of a complete keyboard fix, authenticated integration validation or production speed improvement is made.

This documentation pass changes no application code, protected alert contract, production data or deployment. The local candidate is not release-ready while the reading risk and required acceptance remain outstanding.
