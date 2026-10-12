# Service pricing, POS and checkout

Implementation report, 2026-10-12. Base: `a6fc0d8dba64e8ec37bd6b7e8d3367eab70e0e7b`. Branch: `codex/service-pricing-clarity`. Local candidate only; production schema, client records, Stripe checkouts and subscriptions have not been changed.

## The pricing model

The user selected **Explicit additional fee**. The one-time amount is additional to the first recurring payment. It is not an alternative first payment, deposit credited against the subscription, or amount to collect before the subscription starts.

| Additional one-time fee | Recurring payment | Due at checkout | Subsequent payments |
| --- | --- | --- | --- |
| $500 | $1,500 every month | $2,000 | $1,500 every month |
| $0 | $1,500 every month | $1,500 | $1,500 every month |
| $500 | None | $500 | None |
| $500 | $1,500 every year | $2,000 | $1,500 every year |

The subscription starts when checkout completes, not when the seller saves the sale or sends the onboarding link. The next payment follows one full selected billing period later. The Checkout creation code sets no trial, delayed start or special first-period discount. An agreement for $500 today and $1,500 starting next month needs a different supported billing arrangement; entering a $500 additional fee does not represent it.

## How the parts interact

1. **Service catalogue:** published service revisions supply default one-time and recurring amounts, currency, schedule, names, descriptions and onboarding requirements. A new service selection starts from those defaults. Editing catalogue defaults does not rewrite a frozen sale or an existing Stripe subscription.
2. **POS:** the seller selects services, assignees, manager and agreed prices. The new native POS previously called the inputs Upfront and Monthly and converted other catalogue schedules into monthly amounts. That made the distinction between an additional fee and the first subscription charge easy to miss. The older sales screen already had a combined Due at Checkout explanation, so the ambiguity was not identical on every screen.
3. **Review and save:** the server calculates a quote and returns its hash. A sale commit freezes the selected line prices and onboarding configuration. The sale is committed before the link is delivered. The new native POS requires acknowledgement of the exact reviewed first payment and recurring schedule, tied to that quote hash. Editing prices clears review/acknowledgement; uncertain submissions recover the original sale request.
4. **Onboarding link:** the session token identifies the onboarding run. Opening it does not itself charge the client. Its payment button opens a separate Stripe Checkout. Those are distinct URLs with distinct lifetimes.
5. **Checkout:** the server reads the frozen sale lines, or a committed audited pricing override, and creates separate one-time and recurring Stripe line items. Subscription Checkout collects both the additional fee and the first recurring period. Later subscription invoices contain the recurring items. Existing usable checkout URLs are normally reused.
6. **Payment completion:** the existing payment owner records paid state and unlocks the frozen onboarding. Price corrections do not replace its payment/reconciliation lifecycle.
7. **Service detail and reporting:** service cards and recent POS sales show effective agreed prices. Monthly CRV/PRV are comparison metrics, not instructions to convert a weekly/yearly subscription into a monthly checkout. Original frozen header/line amounts remain historical evidence after a correction; new consumers must use the effective pricing owner rather than interpreting raw frozen columns as current payable prices.

The historical Jason investigation showed why changing one sale total was insufficient: the frozen service lines and a reused Checkout could still carry the previous amount. The recorded two $750 one-time plus $750 monthly lines produced $3,000 initially, while the intended arrangement was $0 additional and $1,500 monthly. This report uses that recorded incident; it does not claim a new audit of Jason's current production account.

## Changed screens and safeguards

- Shared `ServicePriceSummary` displays Additional one-time fee, First recurring payment at checkout, Due at checkout with currency, and After checkout with cadence. It appears in catalogue editing, service detail, native/legacy POS review and public onboarding payment.
- Catalogue lists, the add-service picker, POS cards and recent sales state the first total and subsequent cadence. Labels use Additional one-time fee and Recurring payment. Stripe also labels the one-time line as an additional fee in a mixed checkout.
- Weekly/yearly default amounts retain their original period. A sale cannot combine different recurring schedules through native POS selection; sell those separately. Monthly normalisation remains available for valuation metrics only.
- New drafts carry a pricing-display version. Older drafts are retained under their prior storage key, with a visible instruction to review fresh prices/schedule. They are not silently restored as newly agreed commercial terms.
- Before a new native sale is committed, its submitted pricing acknowledgement must match the quote hash. Existing committed sale receipts remain recoverable without asking the user to create another sale.
- Correct prices is restricted to owners/admins and unpaid selected-service sales. Its entry point is the existing Recent sales list, capped at ten sales; older sales outside that window are not exposed by this editor. Paid subscriptions, processing payments, changing service membership and changing frozen onboarding content are outside this editor.
- Cancelling service delivery now explicitly says that it does not cancel Stripe billing. No automatic subscription cancellation was added.

## Safe correction of an unpaid sale

The editor loads only after the explicit Correct prices action. It shows the frozen service identities and current effective prices, with an optional recurring cadence, a required reason and a required review acknowledgement.

1. Save one account/workspace/relationship/sale-scoped recovery request on the device.
2. Reserve that exact request under a database row lock. Validate role, relationship access, sale state/version, original service identities, nonnegative integer prices, matching totals and supported schedules. An unresolved earlier Checkout creation must be recovered first.
3. Block new Checkout claims while the correction is pending. Retrieve the existing Stripe Checkout by its saved ID and verify both sale and workspace identity.
4. Expire it only while it is open and unpaid. If the expiry acknowledgement is lost, retrieve once to distinguish expired from completed or uncertain state. A copied Stripe URL is not disabled merely by clearing Betelgeze's stored pointer.
5. If completion wins, preserve the prices and reconcile/record payment through the existing payment owner. A completed but unpaid asynchronous payment is treated as processing, not safely replaceable.
6. Only after confirmed expiry, append the immutable commercial adjustment and the effective per-line prices, increment the price revision, and clear the old checkout reservation/reference. Preserve the original sale header, frozen lines, onboarding token/content, service assignments and client history.
7. The same onboarding link shows the new payment breakdown. Its next Pay action creates a fresh Checkout. A button rendered before the correction carries an obsolete pricing revision and returns to the current breakdown rather than reusing a differently priced Checkout.
8. Unknown outcomes keep the reservation and identical request available for recovery. Committed replay makes no additional Stripe call; rejected replay does not change prices. The correction does not automatically send a message.

Database entry points are service-role-only security-definer functions with their own owner/admin and relationship checks. The correction table is private; users cannot mutate it directly. No catalogue or existing migration is rewritten.

## Validation and speed evidence

- Unit/runtime checks cover fee arithmetic, schedule preservation, draft compatibility, correction validation, provider identity, payment-versus-expiry outcomes, unknown responses, idempotent recovery, stale public payment pages and the actual Stripe request payload. No live provider request is made.
- The existing selected-service SQL fixture installs the real amendment migration against the real sale/adjustment/card functions. It verifies role denial, exact frozen-line identity, one reservation, checkout fencing, immutable snapshots, unchanged session token, one audit record, effective projections and payment-race refusal. PGlite provides transaction semantics; this is not a native multi-connection race test.
- Browser fixtures run actual POS, correction dialog, price inputs and shared public summary in production React with mocked API/action boundaries, at widths 320, 390 and 1280 in Chromium and WebKit. They check exact totals, decimals, schedule mismatch, review invalidation, submit acknowledgement, recovery across reload, known stale rejection and horizontal overflow. The public fixture checks the actual summary, not an authenticated full onboarding page.
- Ordinary price rendering adds no requests, effects, subscriptions, timer or provider calls. The review acknowledgement adds no network round trip. The optional correction editor is lazy and reads at most 30 frozen lines/configurations. The normal fixture makes no correction-editor request.
- Existing POS/card/catalogue RPCs extend bounded projections. There is no new read index, trigger or full-history scan. Pricing overrides use keyed JSON lookup by frozen line ID. The new correction's provider work is confined to that explicit action.
- Matched warmed PGlite observations, 110 service instances and six sales, 41 alternating samples after 16 warmups per arm: POS baseline/control/candidate median 5.368/5.413/5.462 ms, p95 5.994/6.743/6.520 ms; card median 4.033/4.042/4.075 ms, p95 4.426/4.372/4.409 ms. Ranges overlap with the unchanged control; these small local observations do not establish production latency or a zero-cost guarantee. POS response bytes: 20,759 → 21,542; cards: 21,615 → 21,612. POS history remains capped at ten sales and service pages at 31 fetched rows. Run with `BE_PRICING_MEASURE=1` using `scripts/validate-selected-service-sales-sql.mjs`.

Final command counts and release state are recorded below. Authenticated acceptance, real Stripe test-mode lifecycle, Android/iOS physical devices and sustained-session performance remain distinct unverified checks.

## Release and rollback

Production release is not authorized by this implementation. Install the additive migration first, verify its exact function definitions/grants/schema reload, then deploy the tested application commit. Enable hands-on acceptance only after the new checkout route and schema are serving together. Test the complete lifecycle in an isolated workspace/Stripe test mode before a production correction: first charge, next subscription schedule, copied expired URL, uncertain retry, payment race and stale page review.

An old application can continue uncorrected sales with revision zero. The SQL claim rejects old creation requests against revised prices, but old application code can return a cached Checkout URL before that claim. Therefore **do not fully roll back the payment handler/context to the original implementation after corrections have been used**. Roll back UI changes while retaining the effective-pricing reader and checkout revision/correction guards, or stop payment entry until a compatible rollback is ready. Retain all audit rows, revisions, recovery records, frozen sales, client files and sessions. Never delete the applied migration or alter accepted invoices/subscriptions to undo a UI release.

## Final local check results

| Check | Result |
| --- | --- |
| `npm test` | 1,671 passed; zero failures, cancellations or skips |
| `node scripts/check-foundation-changes.mjs --base a6fc0d8dba64e8ec37bd6b7e8d3367eab70e0e7b --lint` | Passed; 278 historical migrations preserved, one additive migration |
| `BE_PGLITE_ROOT=/private/tmp/be-device-redesign-pglite BE_PRICING_MEASURE=1 node scripts/validate-selected-service-sales-sql.mjs` | 38 SQL checks passed; timing observations above |
| `node scripts/browser/run-service-pricing.mjs` | 48 scenarios passed across Chromium/WebKit and 320/390/1280 widths, including legacy draft retention and recovery after payment |
| `node scripts/browser/run-service-pricing-catalogue.mjs` | Six catalogue scenarios passed across both engines and all three widths; zero unexpected requests |
| `node scripts/browser/run-foundations.mjs` | 650 checks passed, 325 per engine |
| `npx next build --webpack` with isolated placeholder Supabase environment values | Production build and Next-managed TypeScript check passed |
| `git diff --check` | Passed |

Screenshots were inspected for the public mobile breakdown. All provider-boundary tests are synthetic. No production migration, deployment, client amendment, Stripe expiry, invoice, subscription change or outbound message was performed. The primary checkout's unrelated untracked files were preserved.
