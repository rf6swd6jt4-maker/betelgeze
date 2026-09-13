# SS-03: selected-service POS

Prepared 12 September 2026 against `bf86542e6cd601d81481f4b3c6bc3bbaed0a87a2`. This implements SS-03 in [the service-stage workstream](service-stage-revamp-plan.md), which is tied to the Tuesday Plan. **Production migration installed on 13 September 2026. Application commit `4d1b7d88` deployed successfully; authenticated desktop quote and published-preview checks passed.**

## Resulting behavior

From a relationship's service chart, Open POS lists its Negotiating service instances. The seller explicitly selects the instances to sell, reviews the client, chooses a manager and each service's eligible assignee, adjusts upfront and recurring prices, and reviews the selected onboarding modules. The actual onboarding preview loads on request. The relationship detail retains its continuous information, service Gantt and work queue layout.

For example, selecting Meta Ads and landing page from those services plus Appointment Setting creates one sale and one onboarding session for the first two. Only those two move to Awaiting payment. Appointment Setting stays Negotiating unless the seller explicitly chooses For later or Declined. A later sale creates a separate session. Repeated purchases of the same catalogue service retain separate instance and sale-line identities; shared onboarding modules appear once within a session.

The sale freezes its selected instances, published revisions, prices, currency, billing cadence, seller, manager, assignments and module composition. Unsupported currency/cadence combinations are rejected during review. Finalization rechecks the reviewed version and quote and commits the sale, instance reservations, session, payment work and links in one transaction. Concurrent tabs cannot sell the same instance twice.

After committing, the existing WhatsApp confirmation or opted-in SMS mechanism sends the confirmation request. The existing durable delivery queue sends that sale's onboarding link after confirmation. A delivery failure leaves the committed sale recoverable from Recent sales. A saved request ID in the current browser tab and a durable server receipt let a lost acknowledgement retry the same operation without creating another sale or session.

Checkout remains on the existing payment gate. The native flow stores the exact provider request before sending it; retries preserve prices, signed image URLs, expiry and idempotency key. A replacement requires a known checkout that Stripe reports as expired. An old request with an unknown provider outcome stops for reconciliation. These safeguards were verified with a local database and mocked provider, without a real charge.

Payment advances only the purchased instances into Onboarding. Session submission finishes only that session and creates its applicable review work. Its canonical step and review work link to the exact service instances. The Onboarding panel lists separate native sessions, labels them with their purchased services and opens each through its session ID. Full client links are available only to that session's seller/manager or an administrator; delivery assignees see their applicable modules. Current workspace membership is required.

## Scope and compatibility

- Legacy relationships and sales retain their existing POS, relationship lifecycle, team locking and confirmation/onboarding behavior. The new path applies to native service instances and empty relationships created by SS-02.
- New sales coexist with old records through an explicit selected-services scope. The old one-active-session constraint remains for legacy sessions; selected-service sessions use exact instance enrollment constraints.
- Session-specific payment, completion, access and Onboarding navigation are included because new sales need a functioning destination. This does not complete SS-04: compatible answer prefill, independent readiness into Setup, explicit session selection for ambiguous legacy URLs, and session restart/revoke redesign remain separate.
- Setup/maintenance SOP generation, the remaining service permission consumers, Fulfillment removal and the personal Work Queue are not part of SS-03.
- Installation does not backfill relationships, create a sale, send a client message or charge anyone.

## Performance decisions

The native POS branches before the legacy configuration and team reads. Its candidate read returns 30 records plus a next-page indicator, at most 200 manager choices and the 10 latest applicable sales. Eligible assignees load only when a picker is opened. Selection and price typing are local; there is no request per keystroke.

Review is an explicit authenticated request for no more than 30 selected instances. SQL composes the selected published modules once, deduplicates shared modules and rejects more than 100 modules or a composition exceeding 2 MiB. The pricing review response excludes full module content. Preview media/configuration hydration is deferred until preview is opened. Preview and commit share the same SQL composition owner and snapshot hash.

The native POS uses the existing main-content layout and suspended `ClientContextPanel`, including its context spacer, so opening the context panel cannot cover pricing controls. Context reads remain outside the foreground quote path.

The existing Onboarding list loader is retained. The additional sale-label and access reads run alongside its existing detail reads, with names grouped once by sale. The list's broader pagination remains existing work; no production navigation-latency improvement is claimed here. A previously valid cached legacy Checkout URL still returns before provider configuration work.

These are source, query-bound and fixture observations. Production latency and actual mobile-device memory or battery effects have not been measured.

## Verification

| Check | Result |
| --- | --- |
| Repository tests | 956 passed, including four new runtime tests for input validation, exact provider-request retry, native versus legacy payment behavior, and confirmation replay identity. |
| SQL integration fixture | 13 groups passed using the actual migrations and PostgreSQL functions in PGlite. |
| Changed-file ESLint | Passed. |
| Production Webpack and TypeScript build | Passed. |
| Whitespace/diff checks | Passed. |
| Chromium responsive fixture | Passed at 320, 390, 639, 640 and 1280 CSS pixels. |
| WebKit responsive fixture | Passed at the same five widths. |

The SQL fixture covers composition and deduplication; team, price, cadence and membership checks; selected-only advancement; stale-tab and request replay; frozen sale immutability; independent active sessions; exact module access; checkout recovery and verified expiry; payment/submission isolation; trusted command grants; forced mid-transaction rollback; and repeated catalogue purchases. It uses a minimal fixture for the older platform schema, so it does not substitute for rehearsal against the installed production schema.

The browser fixture runs the real POS component with synthetic read responses. It verifies two selected services with a third unchanged, price editing and totals, manager selection, picker bounds, 44-pixel inputs, and no document overflow. Phone and desktop screenshots were inspected. This is Android/Chrome and iPhone/Safari browser emulation, **not physical-device or authenticated production QA**. It does not click Sell, send a customer message or make a real Checkout request. The later authenticated production preview check is recorded below.

Reproduce the code and database checks:

```sh
npm test
BE_PGLITE_ROOT=/path/to/pglite-runtime node scripts/validate-selected-service-sales-sql.mjs
npx next build --webpack
git diff --check
```

The SQL validator supports an external PGlite runtime and does not add a production dependency. Temporary preview routes and API substitutions were removed before the final build.

## Production release

Reviewable migration: [20260912160000_selected_service_sales.sql](../supabase/migrations/20260912160000_selected_service_sales.sql). SHA-256: `f5f88199960785a1476add313ad3e7849da2cc1de7f5ae9b7192c0b07486d90e`.

1. Preserve the existing Supabase query and use a fresh query for this release. Rehearse the exact migration against the installed schema in a transaction that ends with rollback, including selected-sale and legacy compatibility checks. No provider sending or charging belongs in this rehearsal.
2. If rehearsal passes, apply the migration and verify its functions, constraints, grants and unchanged pre-existing record counts. Record the migration identity and results here.
3. Promote only the scoped SS-03 application commit to `main`, verify the Vercel production deployment, then validate an authorized test relationship from selection through confirmation, checkout and the exact onboarding session.
4. Record authenticated and physical mobile QA separately from build, fixture and deployment evidence.

The user explicitly approved the migration rehearsal, installation and deployment on 13 September 2026, resolving the earlier automatic approval review rejection. A fresh Supabase query preserved the previous editor contents. The exact migration plus a transaction-local behavior rehearsal passed against the production schema and ended in rollback. Checks covered creation of three temporary instances, a two-instance sale, exact request replay, a second independent session and selected-only payment advancement. No provider send or charge was performed.

The subsequent baseline confirmed the rollback: 42 relationships, 46 sales, 23 sessions and one instance, with no receipt table installed. The exact approved migration was then applied successfully. Installation verification found the new commit/checkout functions, private receipt RLS, service-role execution grants, denied authenticated execution and the preserved legacy active-session index. Counts remained 42 relationships, 46 legacy sales, 23 sessions and one instance, with zero new sale receipts.

Vercel confirmed successful deployment of `4d1b7d88` at [deployment FH8BXedvH5XvxMEp8wm9qzjG77HJ](https://vercel.com/betelgeze-projects/betelgeze/FH8BXedvH5XvxMEp8wm9qzjG77HJ). Authenticated desktop Safari checks on Test Client 17 opened the new POS, selected Google Ads, resolved its manager and assignee, reviewed the $750 upfront plus $750 monthly quote, and rendered the actual published onboarding preview. The four modules match the published composition: mandatory Expectations, mandatory Business Information, Google Search Ads, and mandatory Final Steps. The Appointment Setting question remains part of the existing mandatory Business Information module; published content was not edited.

That desktop inspection found that the new POS omitted the established main-content/context-spacer wrapper, allowing the open context panel to overlap pricing. The follow-up restores the shared page structure and context bridge, with a shrinkable full-width POS column. It does not change sale behavior or potential value. The complete 956-test suite, scoped lint and production build were rerun for this layout correction.

No sale was submitted during UI QA. Physical iPhone/Android and real provider-delivery/Checkout walkthroughs remain unverified.

The schema is additive around existing records, but several shared guards are extended. Do not drop native sale/session history or revert shared guards blindly after real sales exist. If a release issue appears, stop new native sale finalizations while retaining the migrated data and compatible payment/completion handlers, then repair the affected path. Code rollback must account for any native sales already created.

Provider references: [Stripe Checkout request limits and expiry](https://docs.stripe.com/api/checkout/sessions/create) and [Stripe idempotent-request behavior](https://docs.stripe.com/api/idempotent_requests).

The subsequent relationship UI and centered three-step POS revision supersedes this release’s original POS presentation. See [relationship-card-pos-release.md](relationship-card-pos-release.md) for changed decline/confirmation/delivery behavior and its validation.
