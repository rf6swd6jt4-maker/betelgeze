# Local fullscreen Comms preview

Start from the isolated worktree:

```sh
node scripts/serve-fullscreen-comms-preview.mjs
```

The default is `http://localhost:3107/` on the Mac. The server prints the Mac's
current LAN IPv4 URL for a phone on the same network, for example
`http://192.168.1.20:3107/`. Use the actual address printed at startup. Keep the
process running and the Mac awake. The server has no public tunnel.

Options: `--host 127.0.0.1` for Mac-only access, `--port 3108` to choose a port,
and `--build-only` to compile without starting a server. Restart the process to
compile source edits. This is a production-mode React fixture bundle, not a
Next development server and not a production performance benchmark.

## What is real

- Both actual Communications workspaces, their chat lists, message bubbles,
  composer/CodeMirror, reply/selection/actions, gallery and shared UI components.
- The candidate full-screen conversation surface and viewport ownership code.
- Actual `app/globals.css`, compiled through the repository's Tailwind PostCSS
  plugin; no substitute chat layout or recreated message styling.
- The existing reading/visibility owners run against synthetic local responses.

The surrounding preview shell uses the existing header/tabbar class vocabulary,
with a local sample workspace and simple retained Comms/Work tabs. It uses the
same mobile shell viewport observer and conversation ownership event. It is
not the authenticated production shell/bootstrap.

## What is local and synthetic

No credentials, user records, existing conversation contents, Supabase transport,
provider delivery or production API calls are included. The preview uses synthetic
Team and Client conversations. Sample sends and edits update browser memory and
reset on reload. Drafts use the real draft owner in this preview origin's local
storage. Attachments become local object URLs and are not uploaded. Account,
portal, provider and other unimplemented actions return a local explanatory error.

The preview replaces only transport/storage delivery seams and Next routing/image
environment wrappers. CSP restricts connections to the local origin and blob URLs;
API requests are answered inside the page. No service worker is registered. LAN
HTTP is useful for layout and keyboard trials but is not a secure installed-PWA
parity claim; features requiring a secure context can differ.

## Acceptance focus

Open a conversation and use its top-left chevron to return. Check that the existing
list and shell remain resident, the full conversation covers the viewport, and
opening/closing does not expose unexpected shell frames. Then check normal tap,
long-press draft selection, multiline text, reply/accessory growth, sending a local
sample, history scrolling, conversation switching and rotation.

Compilation and lint do not establish physical iPhone/Android keyboard behavior.
Production deployment requires separate approval after the user's local review.

## Explicit diagnostic recorder (Local v7)

Open `/?v=7` and tap **Local v7 · Record test** in the list header. Reproduce the
keyboard displacement, return using the chat chevron and tap **Stop & save**.
Recording stops automatically after 45 seconds. Keep the page open until the
header says **Saved · Record again**. A failed upload offers **Retry saving log**.

The recorder tracks 24 structural elements, delegated capture/bubble interaction
events, viewport/window scrolling and resizing, focus and selection geometry,
DOM replacement, resize/mutation observations and numeric computed styles.
It measures frame sampling cost. No observer changes focus, scroll or layout.
It starts only on demand and detaches observers/listeners on stop.

No message text, input data, conversation IDs, credentials or user-agent strings
are captured. The server accepts a bounded numeric schema and saves to:

- `/private/tmp/mobile-comms-displacement/latest-phone-diagnostic.json`
- `/private/tmp/mobile-comms-displacement/latest-desktop-diagnostic.json`

The files include role/event dictionaries and sampling-cost summaries. Vector
field order is defined by the recorder and validated by
`fullscreen-comms-diagnostic-schema.ts`. Each successful run replaces the file
for its device category. Desktop verification does not overwrite phone evidence.
The previous phone trace is preserved as `phone-layout-v2-preserved.json`.

These logs establish DOM geometry and event ordering, not every native compositor
frame. They must be interpreted alongside the observed physical-device behavior.
The recorder exists only in preview scripts; it changes no production layout,
message-reading or alert behavior.
