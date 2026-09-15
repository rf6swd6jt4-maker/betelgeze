# Queue feedback and qualitative priority

## User contract

The personal queue uses four AI-assessed urgency bands: **Must do now**, **Must be done today**, **Can be done tomorrow**, **Can be done this week**. The model assesses the consequence of postponement from instructions, client facts, related work and coarse assignee workload. It does not produce clock-time deadlines or simulate an assumed working day. Existing manual overrides retain their established meanings, including legacy Backlog. Execution status remains separate; blocked work cannot be recommended and started work stays stable.

A saved day anchor prevents “tomorrow” from moving forward forever. Day boundaries use Europe/Dublin by default and can be changed in Feedback. The internal day window measures planning accuracy; it is not a staff performance grade or a new client promise. Recorded dates remain source context, not a generated finish-time UI.

## Durable disputes

Submit uses a stable request ID, checks current ownership and record version, and atomically retains the instruction/version/metadata/dependency snapshot, assigns a reviewer, creates the internal encrypted team message, and accepts background jobs. Duplicate requests recover the original dispute. One open dispute per item is allowed.

Client work routes to its relationship team and fulfilment manager. Missing or ambiguous routing and private Admin work fall back to the private Admin team and an owner/admin. There is no client-conversation, portal, email, SMS or WhatsApp delivery path. The manager receives a targeted “Dispute in [team]” push, subject to existing device subscriptions, read state and active-chat suppression. The durable chat record remains when push is unavailable.

Blocking reasons set the work to Blocked and stop its effort timer. Existing dependencies keep downstream work waiting; unrelated eligible work stays available. Too detailed/Too brief are nonblocking preferences. Resolving requires the responsible reviewer or authorized owner/admin, a resolution note and an explicit decision whether the resolution may inform future work. Resolving does not change canonical instructions or bypass prerequisites/service readiness. Resolved work receives a modest preference within its urgency band and does not interrupt started work.

The Feedback page loads the latest 50 permitted dispute summaries; the original snapshot is loaded separately on open. Work-item links retain their own authorization. Dispute drafts and retry identities use account/workspace/item-scoped session storage.

## Low-cost learning

- Existing GPT-5.4 mini assessments now include an urgency band and short guidance. Context fingerprints still reuse saved results. No read, popup or refresh calls OpenAI.
- A saved dispute receives at most one automatic AI attempt. Structured output offers a manager suggestion; it cannot resolve work, change access or silently modify the SOP. Uncertain usage is retained and not automatically billed again.
- Queue and dispute assessments share the existing 500-reservation workspace/day quota and lock. The existing five-minute scheduler processes bounded durable jobs. Notifications and numerical summaries are independent of AI being enabled.
- Effort sessions start only with deliberate queue starts. Pauses, blocking and completion stop active time. Existing timestamps are not backfilled as active effort. Disputes, source changes, untracked resumes and excessive or implausibly short timers exclude a sample. Users can correct unused recent timer samples; corrections cannot rehabilitate a disputed or reassigned sample.
- Calibration is per assignee plus service/work kind. Five new usable completions are required; the median of the latest 30 ratios can change the multiplier by at most 0.05 per update, within 0.5–2.0. Replaying the same samples has no effect. Early completion does not establish quality, and missed windows do not lower a person's score.
- Three consistent manager-approved presentation preferences move guidance one step, within two steps either way. Preferences can be inspected/reset. Multiple owners receive neutral guidance rather than averaged personal preferences. Approved client/service corrections are bounded to three retrieved examples and cannot override required procedure.

## Performance and verification

Interactive queue reads add indexed joins to saved summaries. No provider dependency or new shell bootstrap was added. Summary workers process at most 1,000 owned items; exceeding the bound preserves existing results and requires workload review. Feedback history is paginated by a bounded recent window, and original instructions load on demand. New lookup and pending-work indexes cover queue reads and unused learning samples.

Local validation: 1,070 repository tests, changed-file ESLint, production Webpack build, database fixtures for ownership/review denial, duplicate recovery, encrypted-message acceptance contract, alternate work, pause/resolution, three-vote preferences, stale publication, five-sample calibration, provider uncertainty and ordinary-role denial. A 1,000-item queue read measured about 48 ms in the PostgreSQL fixture, compared with about 65 ms in the previous access fixture; different fixture runs are not a production end-to-end benchmark.

Browser fixture checks confirm unchanged featured-card geometry on dispute open, required Other details, restored drafts and next-item selection after acknowledged submit. These are local browser checks, not physical-device or signed-in production delivery evidence.

## Release and rollback

Apply `20260915150000_work_queue_feedback.sql` before deploying the new endpoints. It explicitly enables RLS and denies ordinary-role table/function access. The migration extends the existing scheduler; no new provider credentials or client delivery integration is required. Verify database rehearsal, deployment and authenticated feedback separately.

Rollback the app change to remove submission/review controls. Disable the existing queue scheduler/AI flag if background processing must stop, preserving accepted disputes, messages, outcomes and usage. Do not drop the feedback tables or delete original snapshots. Existing tasks and recorded client dates are retained.
