# Bounded encrypted Communications reads

The existing client and native list RPCs materialize all authorized encrypted rows and decrypt them before applying the requested row limit. A selected conversation asking for 500 messages can therefore decrypt thousands of older messages that it never returns.

`20260910230000_bounded_communication_decoding.sql` adds two compatible RPCs. Each resolves authorized conversation IDs once, selects at most 128 candidate message IDs at a time, then invokes the established authenticated single-message decoder. The decoder still checks each message's permission. It stops once the existing requested number of valid rows has been returned. Corrupt or undecryptable rows are skipped and the next batch fills the remaining limit, matching the existing filtering behavior. Timestamp ties use descending message ID for deterministic ordering.

The change does not replace the current decryptors, alter encryption keys, copy content, add plaintext tables, change the response shape, change unread/search rules, or change the interface. The old RPCs remain available. It still returns the existing bounded histories; a selected-message-only bootstrap with exact summaries/unread totals is separate work.

## Pilot and rollback

Apply the additive migration only after the full-schema rollback fixture passes. Enable the RPC selection with `WORKSPACE_COMMUNICATIONS_BOUNDED_READS` set to the pilot workspace UUID. `WORKSPACE_PERFORMANCE_USERS`, when set, also restricts the pilot to the listed authenticated user UUIDs. Both settings accept comma-separated UUIDs or `all`.

The bootstrap and message endpoints pass their already-authorized actor to the selector, so the flag adds no authentication request. Unflagged calls use only their original RPC, with no missing-function probe. A flagged call falls back only for a missing additive function (`42883` or `PGRST202`); authorization and other database failures are preserved.

To stop the pilot, remove the workspace from `WORKSPACE_COMMUNICATIONS_BOUNDED_READS` and deploy the setting change. Clearing the optional `WORKSPACE_PERFORMANCE_USERS` list removes the actor restriction; it does not disable the workspace gate. The new read functions may remain installed: no queued work or changed stored data depends on them. Do not drop or replace the established decryptors as part of rollback.

## Reproducible local evidence

With the optional PGlite package installed as described in the performance command operations guide:

```sh
BE_PGLITE_ROOT=/path/to/temporary/pglite-install node scripts/benchmark-communication-decoding.mjs
```

The runner uses real pgcrypto and the exact current list/single-message decoder and participant helper definitions. Its JWT source and Vault decrypted-secret view are local adapters. Each conversation contains 6,000 synthetic encrypted rows, including seven corrupt newest records. Body, payload and quote output must exactly match the old RPC before timing is reported.

One local run produced these measurements; they are illustrative samples, not production latency predictions or percentile measurements:

| Read | Existing RPC | Bounded RPC |
| --- | ---: | ---: |
| Client, 60 returned rows | 4,378 ms | 52 ms |
| Client, 500 returned rows | 4,359 ms | 384 ms |
| Client initial bootstrap, 2,000 rows | 6,932 ms | 1,579 ms |
| Native, 60 returned rows | 5,292 ms | 68 ms |
| Native, 500 returned rows | 5,194 ms | 479 ms |
| Native initial bootstrap, 4,000 rows | 5,262 ms | 3,809 ms |

The improvement is much smaller when the bootstrap still returns most of the stored history. These results do not establish a subsecond Team launch. Reducing its 4,000-row payload requires the separate summary/unread model; quietly reducing the limit would change current unread behavior.

`tests/sql/bounded-communication-decoding.sql` is intended for the full-schema rollback harness. It uses only that harness's synthetic workspace and users, executes the deployed encryption/quote/conversation triggers, and checks output parity, corrupt-row continuation across batches, timestamp ties, clear-history visibility, AAL2 and participant restrictions. Audit custom/external database triggers before running the harness; no provider send or storage API is called by this test. Production read timings and authenticated UI behavior remain separate verification steps.
