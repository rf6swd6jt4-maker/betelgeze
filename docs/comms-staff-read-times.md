# Staff read times in Message info

## What the current panel can show

An account read cursor records the creation time and ID of the newest message the account has acknowledged. Comms can therefore show which current participants have read through a message. It cannot recover the wall-clock time of that acknowledgement. Device badge positions have a different purpose. A WhatsApp read receipt is separate evidence and can include the time reported for an individual outgoing message.

## Proposed interaction

Keep the circled info action and the same scrollable dialog on phones and desktop. Put a local date and time beside each confirmed reader when evidence exists. For a group, show “Everyone confirmed by 14:38” only when every current recipient has a confirmed time. Use the latest of their first confirmations. Otherwise keep the count and individual rows. Label the roster as current, exclude the sender, and say “Seen · time unavailable” for a known historical read. Keep WhatsApp or SMS delivery in its own section.

The proposed time is when Betelgeze first confirmed the account had read through the message. Opening a chat offline and syncing later can produce a later confirmation. The exact instant someone looked at an individual bubble cannot be reconstructed from a read-through cursor. If device observation time becomes a separate product requirement, it needs separate provenance for queued observations, device clock skew and coalesced reads.

## Recording once per account advance

Capture the previous and new account positions and the database clock in the same transaction that advances the account cursor. An additive, opt-in trigger on the two account cursor tables could cover the existing account and device RPCs in one place. Record only a strictly advancing boundary. A retry, a second device catching up or a duplicate acknowledgement produces no new interval. Keep the current authorization, locks, visibility predicate and response shape.

Each private interval contains workspace, chat kind, conversation, staff account, lower exclusive position, upper inclusive position and confirmation time. Each position retains PostgreSQL microseconds and the message UUID with the existing legacy null-boundary ordering. Keep the boundary values independent of message-row deletion. For a cursor that already exists at activation, its previous position is the lower bound of the first interval. Earlier covered history has unknown timing. For an account with no prior position, the first permitted read covers through its upper bound. In that case an old message can legitimately acquire its first confirmation after activation. No historical backfill is needed.

An advance past 100 messages costs one insert. A unique index on workspace, chat kind, conversation, account and upper position serves both retry protection and the first-covering-interval lookup. On concurrent acknowledgements, take the timestamp after serializing the advance and use the previous committed position. A transaction rollback discards both the advance and its interval.

## Reading on demand

Resolve the selected saved message inside its authorized conversation. A staff-only GET rechecks the session, MFA, membership, conversation access and message identity before returning data. Keep client and Team authorization separate. Resolve the authorized current roster server-side. For each bounded page of recipients, use one set-based query with an indexed seek per account for the first upper position at or beyond the message. Verify the lower bound too. This handles retention gaps and old cursors honestly. Fetch recipients in pages (proposed size 30) and use an aggregate for a group-wide time only if its cost passes measurement. Otherwise show individual times and keep the existing count.

Start the read only when info opens. Fence late responses by account, workspace, conversation and message. Close, navigation or revocation cancels the detail request. The inbox, drafts, badges, push and ordinary history have no dependency on the detail query. No message bodies, provider IDs or device identities belong in the interval table or receipt response.

## Cost and activation decision

This proposal adds a durable insert, index maintenance, storage and WAL to each advancing account read. Its additional transaction latency and storage growth have not been measured. Read volume grows with active readers and how often they advance. A domain-specific retention period and staff disclosure policy need a decision before activation. Purged intervals must result in an unavailable time.

Before implementation approval, rehearse the two RPC paths with synthetic PostgreSQL data, comparing write latency (including p95), WAL and index bytes, and lookup plans across long histories and large rosters. Exercise concurrent devices, lost acknowledgements, offline coalescing, stale requests, legacy null boundaries, deleted targets, a membership change, mixed-version clients and retained intervals with gaps. Verify that an info lookup cannot advance a read or affect notification suppression. If the write adds material cost, present the measured tradeoff under the performance contract.

Roll out to an isolated workspace first after separate approval. Disable interval capture and the times UI independently on rollback. Retain accepted intervals and the original cursors. This design has no installed migration or active tracking.
