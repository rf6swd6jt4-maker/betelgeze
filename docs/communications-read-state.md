# Communications active reading and unread navigation

## Defects and repair

`addTab()` changed the active iframe without sending a departure to the previous
one. Other activation paths also relied on scattered asynchronous messages.
The previous chat could retain an active flag, save incoming messages as read,
and advertise an active chat to the push-delivery gate. Every shell activation
now synchronously publishes its selected tab ID and revokes the other frames.
Readers and activity heartbeats check the current shell selection as well as
visible/focused document state. The deferred read effect checks again at dispatch.

Each mounted Communications panel previously replaced a single shell unread
number with its own local total. A stale resident copy could restore counts.
Successful read acknowledgements now propagate through a workspace/account-scoped
local event and BroadcastChannel. Cursor merges reject older positions, including
out-of-order native Realtime updates. Timestamp comparisons preserve PostgreSQL
microseconds and normalize equivalent timestamp encodings. Unread calculations
use message positions, not array order. The read endpoints use an authenticated,
access-checked transaction lock to prevent concurrent old writes from moving a
saved cursor backwards.

The shell owns an authenticated unread summary, independent of mounted chat
panels. It reuses the existing workspace Realtime connection for invalidation,
coalesces bursts and deduplicates in-flight summary requests. A response started
before a newer message/read event cannot overwrite the newer state. Reads clear
only a matching summary that contains no later unread arrival. With no open
Communications tab the existing count primitive appears in the sidebar.

## Performance and correctness

No extra work is added to the initial shell server-rendering dependency chain.
The summary starts after mount and uses a metadata-only SQL RPC: no message
bodies are fetched or decrypted by that read. It uses existing conversation/time
indexes, scans at most 100 unread result rows per authorized conversation, and
returns compact per-conversation counts/positions. The UI displays 99+ above 99.
Realtime invalidation reuses the existing socket (four table subscriptions);
its normal RLS-protected change payloads are ignored. Hidden documents defer
summary reads until visible. No full app reload, tab remount, history download,
background polling interval or change to grouped push payloads is introduced.
Existing push grouping, delivery and notification-clearing functions remain.

## Deployment

Apply only `20260917140000_communications_unread_state.sql` before releasing the
application revision. It adds two authenticated functions and no table, column,
backfill or message mutation. Old clients remain compatible. Do not deploy the
new read endpoints before the functions exist. Roll back application code first;
the additive functions may remain unused safely.

## Verification

See the release record for final results. Runtime regressions exercise current
shell activation, cross-copy reads, stale responses, newer arrivals, account
isolation and timestamp precision. The SQL fixture uses synthetic data with the
repository's actual conversation-access functions, checks both kinds of chat,
unauthorized readers, AAL2, older reads, microseconds, own/system messages and
cleared history. A 10,000-message fixture caps at 100; its conversation range
uses an index. Local database timing is not a production or physical-device
performance measurement.

## Superseding contract

`app-alerts.md` is the protected source of truth for reading and notifications. The 17 September alerts rebuild replaces optimistic local badge clearing and single-slot pending reads with the shared acknowledged reader, per-conversation recovery, shared summary publication and latest-row visibility. The release status and evidence for that rebuild are in `docs/app-alerts-validation.md`.
