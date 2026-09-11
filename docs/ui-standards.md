# Betelgeze UI standards

Repeated interface elements use the primitives exported from `components/ui`, `components/panel`, `components/list`, and `components/detail`. New UI must not recreate them with page-local Tailwind classes.

## Workspace shell layers

Before the shell arrives, `AppStartupScreen` shows a centred white Betelgeze diamond on `#171717`, using inline SVG and styles so it does not wait for assets. It disappears as soon as the shell is present. Tab loading stays inside the shell on a dark canvas; an iframe's document-load event alone must not reveal it before its app bridge is mounted.

Keep the shell stacking order explicit: tab content `30`, relationship context `35`, tab bar `40`, mobile sidebar dismiss surface `45`, sidebar `50`, top bar and its dropdowns `55`, notices `60`, and dialogs `90` or higher. The top bar creates a stacking context, so increasing a dropdown's own z-index cannot lift it above a sibling sidebar. Keep the entire top bar above the sidebar so account and desktop/mobile search popups stay visible and clickable. Use `AnchoredPopup` for editors that must escape an iframe or clipping ancestor; loading overlays remain above all interactive surfaces.

Top-bar mutation feedback uses short, bounded labels (`Saving…`, `Saved`, `Action failed`). Full error details stay in the originating form and the status tooltip/accessibility label; they must never expand the header or displace search, navigation, presence, or account controls.

## Offline recovery

The online workspace retains its existing layout and network loading paths. `WorkspaceOfflineStatus` uses the shared compact `Status` mark and appears only when offline or messages need recovery; it links to saved chats. Sidebar destinations requiring a server are dimmed while offline, while loaded screens and chat composition remain available. Reconnection never reloads the active screen or interrupts typing.

`ChatOutboxStatus` identifies locally saved messages separately from server-confirmed delivery. Cancel is available before a request is dispatched, and after a definite rejection. An uncertain send retains its original request ID until reconciled. Failure must never clear a draft before either durable device storage or server confirmation succeeds.

The service worker's recovery document (`public/offline.html`) is deliberately independent of React, authenticated documents, and Next.js chunks so it can open after a cold offline launch. It uses native navigation and a native chat selector rather than a record list, and a simple message timeline. Other panel destinations are disabled. Its static styling follows the same neutral surfaces and restrained status colours; it does not define alternative application primitives. Cache only a bounded recent message history, identify when it was saved, and render messages as text. Attachments require connectivity. Clear saved chats, pending sends, and staff drafts on account change or logout.

## Popup motion

Every custom popup uses the shared opening motion on both mobile and desktop. Apply `betelgeze-popup-enter` to the visible menu, tooltip, field editor, or dialog surface: a `140ms ease-out` opacity fade with `4px` of upward travel into its final position. `AnchoredPopup` applies this automatically once its initial position is measured; do not animate its children a second time.

- Animate the dialog card, not its full-screen backdrop. Backdrops appear immediately and remain stationary.
- Use `betelgeze-popup-fade` for full-screen previews, lightboxes, and viewport-filling client panels where movement would expose an edge or disturb fixed descendants.
- Closing is immediate. Do not delay dismissal, navigation, focus restoration, or input behind an exit animation.
- Opening motion runs once when the surface appears, not when its contents load, resize, scroll, or update. Do not key an entire popup by changing form values or search results.
- Both shared classes disable animation for `prefers-reduced-motion: reduce`.
- Keep motion limited to opacity and transform. Do not animate dimensions, layout coordinates, blur, or shadow; do not add animation libraries, JavaScript frame loops, persistent `will-change`, or retained animation transforms.
- Preserve portal ownership, viewport clamping, stacking levels, focus behaviour, and outside-click/Escape dismissal. Existing sliding navigation panels and loading indicators retain their separate behaviour; browser-native selects and confirmation prompts remain browser-controlled.

## Message action gestures

Message bubbles use `NativeMessageBubble` for action activation in client chats, team/direct chats, and the client portal. Desktop opens the action popup on right-click; touch opens it after a stationary `450ms` hold. A normal click or tap does not open message actions. Movement beyond `10px`, multiple touches, touch cancellation, release before the threshold, or unmount cancels a pending hold. A completed hold must not also trigger a reply/delete swipe or a synthetic click.

Preserve embedded links, buttons, audio/video controls, and scrolling. Keyboard users can open actions with Enter, Space, the context-menu key, or Shift+F10 while the bubble is focused. Popups use the shared opening motion above.

Message actions and reactions use `MessageActionPopup`, backed by `AnchoredPopup`. Center the popup above the right-click or long-press point, with a `6px` gap and `8px` viewport margins; near the top, place it below the point when that provides more space. Keyboard activation uses the bubble's top center. Translate the point into the parent shell for iframe chats, clamp to the visual viewport, and remeasure when content or viewport size changes. The custom emoji form participates in the popup layout so its full bounds are measured. Oversized menus wrap or scroll inside those bounds. Outside presses, Escape, navigation, and inactive tabs dismiss the popup.

Native team/direct chats use one `Quote` action in the former Reply position, with the same reply-arrow icon and a tooltip explaining optional text selection. It immediately opens the normal reply composer and previews the whole message by default. For saved messages with text, `MessageQuoteSelection` observes selection in the original body and updates the preview live; no confirmation step replaces the composer. A selected passage is retained when focus moves to the draft; collapsing the selection inside the source returns to the whole message. Other messages and reactions dim and become inert while the source stays selectable. Native selection and its touch handles own the gesture; bubble holds, swipes, link activation, and checklist changes must not compete. Arrow keys move the selection caret, Shift extends it, and Escape cancels the reply. Client chats and the client portal retain ordinary Reply and do not offer quoting.

Quotes use the reply preview and composer preview with the selected passage in quotation marks. Persist the passage and its UTF-16 offsets in the visible formatted text, excluding formatting delimiters and list controls. Tapping a quote loads/reveals its original message and marks only the passage in `ChatMessageText`; ordinary replies retain the whole-message flash. An edited passage may relocate only when its match is unambiguous; a missing passage must never highlight unrelated text. A deleted original leaves the saved quote readable with navigation disabled. Quote snapshots follow native-message encryption and authorization.

## Chat layout motion

Client, team/direct, and portal chats share `ChatMotionViewport` for keyboard movement. The shell (or standalone portal controller) remains the sole owner of viewport geometry. Keep the chat header stationary and move the messages and composer together inside a clipped layer, using a 300ms transform with `cubic-bezier(0.32, 0.72, 0, 1)`. Resize the scrollable layout at transition boundaries and synchronously preserve its reading position; do not animate the containing iframe's height or add a second footer keyboard animation. Interrupted movement starts from its current visible position. Continuous browser viewport updates are applied directly, and reduced motion skips animation. Final scroller resizing waits for an active touch scroll to settle. A missing animation finish event resolves to real layout after the duration plus 400ms, still respecting an active scroll. Page suspension/return clears interrupted gesture state and releases transient transforms.

`createComposerViewportController` shares focus and keyboard state between the workspace and portal. A new focus uses the current viewport edge and preserves the known resting height; it must not replay a cached open-keyboard endpoint during a close. Repeated focus/blur notifications are idempotent. Opening rebound protection ends after measurements settle; shorter keyboards and keyboard dismissal without blur must recover without another tap. Reject zero/non-finite measurements, overscroll outside the layout, and native zoom samples. Recheck after 640ms of quiet, with at most one 80ms confirmation for metrics that arrived after their event. New input, suspension, and teardown invalidate stale callbacks. A close callback never writes geometry itself, and partial closure must not become the resting baseline. Repeated taps have no cooldown. Touch/pen focus runs synchronously on a stationary pointer release; mouse focus stays on pointer-down. Do not move the composer on touch contact, cancel native activation, or use delayed blur/refocus retries.

Workspace composer focus notifications identify their source window; only the active frame (or host) can change shell keyboard state. Reconcile the actual focused composer on viewport updates, tab switches, and foreground return. Deactivation blurs the hidden frame's composer without discarding its draft. Workspace and portal keep up to 64 geometry/lifecycle samples in `window.__betelgezeChatViewportDiagnostics` for Web Inspector; these contain no message text, URLs, or user identifiers and are neither persisted nor transmitted. Physical-device checks must cover Home Screen and browser modes, rapid reopen, keyboard/emoji/dictation height changes, lock/unlock, app/tab switching, interrupted scrolling, rotation, and native selection handles. Desktop browser fixtures do not establish physical-iPhone behavior.

The workspace must not reset document scrolling during keyboard focus, blur, or viewport movement. WebKit's native focus scroll can otherwise move the whole fixed shell down and back up. `createViewportOriginRecovery` repairs residual document scroll only after the unfocused, unzoomed viewport has returned to its full height and origin for two frames. New focus, viewport changes, suspension, and teardown cancel pending recovery. Never compensate by translating the shell by `visualViewport.offsetTop`.

`ComposerFooter` owns the 180ms height transition for multiline drafts, reply previews, and attachment/sticker trays. Its footer stays aligned to the bottom while the message pane follows the changing height. Desktop and reduced motion use immediate sizing. Keep native editor scrolling, selection, and composition intact; mark its scroller with `data-composer-scroll` so footer gesture containment permits long drafts to scroll.

## Chat message formatting

Composer touch containment must yield to a non-collapsed selection when the gesture starts in the focused editor or a native selection handle immediately around it. Check both touch start and movement (long press can select after contact), and preserve that gesture until release even if the selection handles cross. Selected text does not release containment on surrounding buttons, distant footer padding, or a separate sticker tray. Ordinary unselected drags at editor scroll boundaries still prevent page panning.

Client, team/direct, and portal message bodies use `ChatMessageText`. Supported inline syntax is `**bold**`, `__italic__`, `~~strikethrough~~`, and `##heading##` (slightly larger and bold). HTTP(S) links remain clickable and message HTML remains plain text. Message-content lists use semantic `ol`/`ul` elements, with `1. `, `- `, and `[ ] ` markers and two-space nesting. These are authored message content, not record collections covered by `List`.

Composers share `ChatComposerInput`, a CodeMirror text editor with live formatting. Only paired inline delimiters (`#`, `*`, `_`, `~`) are dimmed; list prefixes render as boxes, bullets, or full-color numbers with hanging indentation. Marker replacements preserve the underlying text and behave as one unit for cursor navigation and deletion. Use the editor’s selection renderer with its native-caret suppression so only one caret is painted. Keep native selection, composition, paste, undo/redo, responsive wrapping, and keyboard navigation intact. Programmatic draft replacement resets undo history so text from another conversation cannot be restored. The editor grows up to the existing four-line mobile/seven-line desktop area and then scrolls; viewport focus/blur remains shell-owned. Set font size and line height on the editor scroller itself: 16px/24px with 10px vertical padding on mobile, and 14px/20px with 8px padding from 1024px. The one-line content area is exactly 44px/36px tall, with the placeholder and typed line centered consistently. Do not add a separate taller editor minimum height or rely on a bare `&` rule nested in the editor theme’s media query.

Enter continues a list and increments numbered markers; new checkbox items are always unchecked. Enter on an empty item removes the marker and exits the list. Tab/Shift+Tab indent/outdent a list line by two spaces. Shift+Enter inserts a plain newline, and Enter outside a list retains send behavior. The send button remains available while composing lists.

Headers receive a small gap above when following a nonblank line, both while composing and in sent text; a heading at the beginning adds no extra top gap.

Sent checkbox items use `[ ]`/`[x]` and an accessible checkbox control. Markers stay beside the item’s first line; wrapped text aligns under the item text. Checkbox controls use `data-icon-button` and one line-height for their height, bypassing the mobile 44px ordinary-button minimum. Checking an item strikes through its text. Users with write access to a native chat, authorized staff in a client chat, and active relationship-scoped portal participants may toggle items. A dedicated action validates the stored checklist, changes only that marker, and uses a conditional encrypted-body update to preserve simultaneous changes. It does not grant general message editing rights or transmit an edit to SMS/WhatsApp. Activity records the actor, message, item line, and state without copying message text. Existing message subscriptions and portal refreshes distribute the saved state.

Checklist controls remain usable while saving. `createChecklistUpdates` projects each click immediately, serializes saves per message, and coalesces repeated clicks on an item to its latest requested state. A response must not erase later queued choices; the next request uses the last confirmed body. Marker-only refreshes cannot replace pending intent, while changed wording/line structure cancels old queued line numbers. Use `aria-busy` on the affected checkbox without disabling the entire message. Retry an uncertain acknowledgement once, with a 15-second timeout per request; confirmed failures restore the last known state and show an inline error. Accepted queued changes continue if the message unmounts. Workspace routes return the saved body and retain the older message envelope without requiring a second post-save reload; portal refreshes fence reads across the entire save. Preserve the existing write permissions and encrypted compare-and-swap boundary.

## Status

`Status` communicates operational state, health, or progress. Its appearance follows the lead-generation poll UI: a Betelgeze diamond followed by plain text.

Statuses have exactly four tones:

Use `surface="light"` on light client-facing surfaces such as onboarding. This keeps the same diamond and tone meanings with darker text and marks for readable contrast. The default remains the workspace's dark surface.

| Tone | Meaning | Typical examples |
| --- | --- | --- |
| `grey` | Not started, inactive, unknown, or neutral | Initialising, queued, disabled |
| `yellow` | Active, waiting, or needs attention | In progress, pending, warning |
| `green` | Genuinely successful or ready | Successful, completed, verified |
| `red` | Failed, blocked, cancelled, or unavailable | Failed, error, blocked |

Do not add blue, violet, or other status colours. A configured, managed, or pending integration is not green unless the real path has been verified.

```tsx
<Status label="Initialising" tone="grey" />
<Status label="In progress" tone="yellow" />
<Status label="Successful" tone="green" />
<Status label="Failed" tone="red" />
```

In space-constrained visualisations such as Gantt bars, use `compact` to show only the canonical status mark. The component retains the status label for assistive technology and hover disclosure; do not recreate a local dot, circle, or icon treatment.

```tsx
<Status label="Overdue" tone="red" compact />
```

### StatusStat

`StatusStat` is the compact numerical sibling of `Status`. It uses the same four tone meanings and typography, but a bold tabular number takes the place of the Betelgeze diamond. Use it for small grouped state counts such as source-settings summaries; do not use a pill or a hand-built coloured count for this pattern.

```tsx
<StatusStat value={12} label="Enabled" tone="green" />
<StatusStat value={0} label="Disabled" tone="grey" />
<StatusStat value={8} label="Not mapped" tone="yellow" />
<StatusStat value={2} label="No config" tone="red" />
```

## RoundPill

`RoundPill` represents assigned or attached things: services, modules, people, categories, filters, or other compact metadata. Its aesthetic comes from the assigned service and module pills in onboarding detail.

Pill colours are fixed RGB values rather than translucent utilities, so they remain identical on every surface. The first two recipes are sampled directly from the approved RoundPills; the remaining recipes preserve the same dark face, chromatic edge, and pale text relationship:

| Tone | Border | Background | Text |
| --- | --- | --- | --- |
| `emerald` | `#014E38` | `#051C16` | `#A4F5CF` |
| `sky` | `#01426B` | `#051B29` | `#B6E4FC` |
| `yellow` | `#8A7D00` | `#2B2A08` | `#FFF3A3` |
| `amber` | `#6D2D00` | `#281206` | `#FEE685` |
| `red` | `#720810` | `#28090A` | `#FFC9C9` |
| `violet` | `#440D89` | `#1D0C39` | `#DDD6FF` |
| `neutral` | `#404040` | `#171717` | `#D4D4D4` |

These values are the palette definition. Do not substitute nearby framework colour tokens or recreate them with opacity.

`yellow` is the canonical tone for `Test` labels across the platform. It retains the same glassy, near-black chromatic face as the rest of the palette, but keeps its red and green channels close so it reads as yellow rather than amber or brown. `amber` is warmer and more orange; retain it for labels that need that distinction rather than using it as a substitute for `Test`.

Use `Assignee` when the attached thing is a person assigned to something. Its default is the canonical avatar-and-name form of `RoundPill`; do not assemble a separate profile-picture treatment for assignees. In space-constrained visualisations such as Gantt bars, use its `compact` avatar-only mode.

```tsx
<RoundPill tone="emerald">Paid Social</RoundPill>
<RoundPill tone="sky">Reporting</RoundPill>
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} />
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} compact />
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} compact compactSize="md" />
```

## SquarePill

`SquarePill` is the boxier, rounded-corner label treatment. Use it for categorical labels such as `Stuck` or `Test`. It shares RoundPill's border, background, text, spacing, and colour palette; only its shape differs.

```tsx
<SquarePill tone="amber">Stuck</SquarePill>
<SquarePill tone="yellow">Test</SquarePill>
```

## RelationshipStage

`RelationshipStage` is reserved for relationship lifecycle stages. It reads its border, background, and text colours from the exact same `pillTones` definitions as `RoundPill`; it must never maintain a separate stage palette. It is otherwise identical in height, typography, border weight, and spacing. The only difference is its silhouette.

The silhouette is a rectangle with half of a Betelgeze diamond attached to each end. It is exactly 24px high. Each pointed end is 12px deep, so its upper and lower edges travel at 45 degrees and meet at the vertical midpoint. In polygon terms, the six outer points are: top-left after 12px, top-right before 12px, right midpoint, bottom-right before 12px, bottom-left after 12px, and left midpoint. Do not soften, round, shorten, or reinterpret these four diagonal edges.

Relationship stages are categorical labels, not operational statuses. Their stage-specific colours therefore do not expand or alter the four-colour `Status` meanings. Pass the lifecycle phase itself so the component owns both its canonical wording and colour.

The lifecycle palette assigns distinct tones to the active parent stages: Lead `sky`, Potential Client `amber`, Sold `emerald`, legacy Invoiced `yellow`, Onboarding `violet`, Onboarding Review `emerald`, Fulfilment `red`, and Retention `neutral`. These are categorical Gantt colours, not status meanings.

```tsx
<RelationshipStage phase="onboarding" />
<RelationshipStage phase="fulfilment" />
```

Do not use this shape for statuses, tests, warnings, services, modules, or arbitrary metadata.

## Shared rules

- Use sentence case; do not add uppercase tracking to ordinary pills or statuses.
- Pick pill colours by stable category. Status colours always retain the meanings above.
- Keep compact elements short. Put explanations in adjacent copy, a tooltip, or expanded detail.
- Extend a shared primitive when a new stable variant is required. Do not invent a one-off treatment in a page.
- When the design changes, update `components/ui`, this document, and existing uses together.
- A local exception must include a code comment explaining why the shared primitive cannot represent it.

## PanelTabHeader

`PanelTabHeader` is the canonical heading block for a workspace panel tab. It names the active tab and its primary content, not the wider panel that contains it.

```tsx
<PanelTabHeader
    title="Leads"
    description="Qualified owner-phone leads from the latest poll."
    actions={<NewPollButton />}
    tabs={<PanelTabs items={leadGenTabs} active="leads" ariaLabel="Lead Gen panel" />}
/>
```

- A panel home route uses the home tab or list name: `Work Queue`, never `Admin`; `Leads`, never `Lead Gen`.
- The description directly explains the active tab's content, ordering, or purpose. It must not summarize every capability in the parent panel. Begin with stable copy that identifies the list; a following sentence may adapt to the current list contents. Desktop descriptions occupy one visual line and truncate when necessary, so put the stable information first; mobile descriptions may wrap.
- When the panel contains multiple tabs, `PanelTabs` occupy a dedicated row immediately beneath the description and above `QuickStats`, filters, or tab content. They remain horizontally scrollable on mobile.
- The title-to-description gap is always `0.5rem` (`mt-2`). Do not reserve blank description lines or add a minimum height to the description slot.
- Optional primary actions occupy the header's right-hand action slot on desktop. The action row bottom-aligns with the actual bottom of the description line, not with an artificial header height.
- Put one principal action in this slot, such as `New Poll` or `Start new relationship`. Supplementary metadata may sit immediately before it, but the primary action remains the final, rightmost control.
- On mobile the action slot follows the description and uses the full available width without displacing the title or tab row.
- Do not place tab navigation beside the title, inside the action slot, below statistics, or in page-local wrappers with different spacing.
- A tab containing a list has exactly one page heading. Do not repeat the list name or add another explanatory list header between the panel tabs and the list.
- If a tab changes its principal content through a tab query such as Admin Work/OKRs, the heading and description change with the selected tab.

The standard vertical order is:

1. `PanelTabHeader`: title and description/action row, then `PanelTabs` when the panel has tabs.
2. `QuickStats` or another approved analytical summary.
3. One or more `FilterRail` rows.
4. The list itself.

Do not place filters above quick statistics when both are present.

Every immediate step in that order uses the same `1.25rem` (`mt-5`) top gap. Measure it from the actual bottom of the preceding element: the description and primary action share one bottom line, then tabs, stats, rails, or direct content begin from that line. Do not use page-local `mt-6`, reserved description height, spacer blocks, or margins that make one tab breathe differently from its siblings.

A list tab must not insert a page-specific summary, capacity note, explanatory paragraph, owner roll-up, or other bespoke information block between these standard elements. Put stable explanatory copy in the tab description, append genuinely useful dynamic context to that description, express a compact measurement through `QuickStats`, or omit it. Transactional errors and actionable warnings use the platform's approved notice treatment and are not list summaries.

## QuickStats

`QuickStats` is the canonical compact summary strip above a list. The Polls tab is the visual reference. It communicates a small set of immediately useful counts or short measurements; it is not a filter and its boxes are not individually clickable.

```tsx
<QuickStats items={[
    { label: "Running", value: runningCount },
    { label: "History", value: pollCount },
    { label: "Source checks", value: checkCount, hideOnMobile: true },
    { label: "Raw returned", value: rawCount },
]} />
```

- Use three visible statistics on mobile. A fourth lower-priority statistic may set `hideOnMobile` and return from `sm` upward.
- Mobile renders one consolidated, bordered strip with internal dividers. Desktop separates the same statistics into evenly sized bordered boxes.
- Labels are short neutral text; values are prominent, tabular, and limited to one line.
- Prefer current list facts such as actionable count, reserved time, open failures, or poll results. Do not fill the strip with decorative totals.
- Capacity and forecast information belongs here when it can be expressed compactly, for example `Capacity — 10h late`; do not repeat it in a prose block beneath the filters.
- `QuickStats` summarizes the currently meaningful list scope. Filtering may update the values when that makes the summary more truthful.
- Use `StatusStat` for small inline status counts inside a settings or status context; use `QuickStats` for the top-of-list summary strip.

## FilterRail

`FilterRail` is the canonical list-filtering mechanic. Its appearance and behaviour come from the Relationships lifecycle rail.

```tsx
<FilterRail ariaLabel="Filter relationships by lifecycle stage">
    <FilterRailLink href={allHref} selected={!phase}>All <FilterRailCount>{allCount}</FilterRailCount></FilterRailLink>
    <FilterRailLink href={leadHref} selected={phase === "lead"}>Lead <FilterRailCount>{leadCount}</FilterRailCount></FilterRailLink>
</FilterRail>
```

- Each rail represents one filtering dimension. Use a second rail with `spacing="tight"` when a list genuinely needs another dimension, such as Maintenance state plus category.
- The selected option uses plain white text and a white underline. Unselected options remain neutral and acquire only a restrained hover underline.
- Counts sit beside labels in subdued tabular text and should reflect the other currently selected filter dimensions.
- Prefer `FilterRailLink` and URL-backed query parameters so filters survive refresh, back/forward navigation, sharing, and tab restoration.
- When the complete candidate collection is already present in the page, add `instant` to `FilterRailLink` and render records through `InstantFilterResults`. This keeps the URL authoritative while applying the visible change locally instead of rerunning the server page. Keep paginated, permission-dependent, or data-dependent filters server-backed.
- Use `FilterRailButton` only for local interactive state that cannot reasonably be URL-backed, such as the live Work Queue's Business/My work view.
- Independently fetched panels in the client portal may retain their local filter state through `FilterRailButton`. Use `FilterRail surface="light"` for the same underline mechanic with theme-coloured selection, readable muted text, and 44px targets; the workspace default remains dark.
- Rails never wrap. They scroll horizontally on mobile while preserving option order.
- Do not recreate filter pills, segmented boxes, dropdowns, or page-local category chips when the available choices fit a rail.
- When `QuickStats` and `FilterRail` are both present, every stats block comes first and the first rail follows beneath it.

## List

Client-facing collections use `List surface="light"`. This retains the same two-row structure, borders, and interactions with the onboarding theme's surface and text colours. The surface propagates to its shared row/title primitives. Client-facing detail panels likewise use `DetailFields surface="light"` and `Status surface="light"`; workspace defaults remain dark. Use `DetailFields columns={1}` in narrow side panels so fields do not split into two columns at desktop viewport widths.

The client portal dashboard fits within the dynamic viewport. Appointment history, file history, and chat scroll inside their panels; the document does not scroll. Keep upload controls and upload feedback outside the file-history scroller. Desktop shows both dashboard panels; smaller screens switch them in place with a light `FilterRail`. Keep both panels mounted when switching so uploads continue, and keep Chat available in the header without duplicate appointment/file anchor links.

Inside an already bordered dashboard section, use `List embedded` to retain its consolidated collection and row dividers without a second rounded perimeter. Simple client-facing lists use `ListPrimaryAction` in `ListTrailing` for a single clearly labelled action, such as `Details` or `Download`, visible on desktop and mobile. Their titles also activate that destination directly; do not cover these actions with `MobileListActionSurface` or require an overflow menu for the only operation. Keep internal record IDs out of client-facing lists and prioritise the appointment time or file size and upload date instead. Staff lists retain their audit IDs and existing mobile action menus.

`List` is the canonical presentation for a collection of comparable records that people need to scan, open, and act on. Leads, polls, and relationships are the reference implementations. A list is not a gallery, settings form, navigation rail, timeline, disclosure log, or nested planning structure such as OKRs.

### Anatomy

Use the primitives in `components/list`:

```tsx
<List ariaLabel="Polls">
    <ListItem>
        <MobileListActionSurface actions={actions}>
            <ListPrimaryRow>
                <ListTitle href={itemHref}>Item name</ListTitle>
                {/* categorical labels */}
                <Status label="In progress" tone="yellow" className="ml-auto" />
            </ListPrimaryRow>
            <ListSecondaryRow>
                {/* flexible domain metadata */}
                <ListTrailing>
                    {/* ID, time, creator, desktop actions */}
                </ListTrailing>
            </ListSecondaryRow>
        </MobileListActionSurface>
    </ListItem>
</List>
```

- `List` owns the consolidated black surface, `rounded-2xl` outer corners, neutral border, clipping, and list semantics.
- `ListItem` owns the divider between records and the restrained hover highlight. Its divider uses `border-neutral-800`, exactly matching the outer list border. Do not wrap every item in its own floating card.
- `ListPrimaryRow` is the identity and state band. It has the subtly tinted surface and an internal `border-neutral-900` divider.
- `ListSecondaryRow` is the supporting-information band. It is always one line and never wraps.
- `ListTitle` is the primary identity, always placed first and given the flexible width. Link it whenever the record has a canonical destination. It truncates rather than displacing state or actions.
- `ListTrailing` is the stable audit/action cluster at the end of the supporting row.

### Information order

The primary row follows this order:

1. Primary item name on the left.
2. Stable categorical labels immediately after the name, such as `Test`, `Manual`, or `RelationshipStage`.
3. Exactly one operational `Status` aligned to the right. A compact companion such as poll duration may sit beside it.

The secondary row follows this order:

1. Domain-specific supporting information in descending importance.
2. Measurements, contact routes, source information, or assigned-item pills where relevant.
3. `ListTrailing`, ordered as short ID, relevant relative time, creator, then overflow actions.

The meaning of the time may vary—created, updated, or latest activity—but its position and subdued treatment do not. Use the creator tooltip to disclose whether an item was created or added and its exact timestamp.

### Content and density

- Lists are intentionally two rows. Do not flatten them into a dense one-row table at wide breakpoints.
- Keep the primary row calm. It contains identity, categorical labels, and one operational status—not general metadata.
- The secondary row is flexible rather than column-prescriptive. Omit unavailable fields cleanly; do not render empty column placeholders.
- Use `text-sm` and neutral supporting colours. Reserve `text-base font-medium` for the primary name.
- Use the shared `Status`, pill, stage, creator, and action components. Do not recreate their appearance locally.
- Use short, scannable values. Longer explanation belongs on the detail page or in an intentionally designed preview field.
- Keep one obvious primary destination and move secondary operations into `ListActionMenu`.

### Responsive behaviour

- Preserve the same two semantic rows at every breakpoint.
- Each semantic row is exactly one visual line high. Neither text nor a UI element may wrap beneath another item inside that row; a two-line primary or secondary band is not permitted.
- The title receives flexible space and truncates first. Primary labels, stages, and statuses are single-line, non-wrapping elements.
- On the secondary row, preserve the most important domain value on mobile and progressively reveal lower-priority values at `sm`, `md`, `lg`, and `xl`. Do not attempt to retain every desktop field by wrapping it.
- Mobile priority is: the short ID, one useful non-sensitive core measurement where appropriate, then the relative time and creator. The short ID is always visible. Secondary descriptive metadata, locations, and assigned-item pills appear only when the available breakpoint can accommodate them on the same line.
- Relationship phone numbers, WhatsApp numbers, and email addresses are never shown in the mobile list. They return at their documented wider breakpoints and remain available as copy actions in the mobile action popup.
- Assigned services use `MobileAssignedServices` below `sm`: show the first unique service as an emerald `RoundPill`, followed by a plain `+N` count when more unique services are assigned. Never render a second service pill on the mobile row. When none are assigned, show `No assigned services` in neutral supporting text rather than leaving an unexplained gap.
- Mobile and desktop service renderers must be mutually exclusive. Put responsive `hidden`/display classes on a wrapper around desktop pills, never directly on `RoundPill`; the primitive owns `inline-flex`, so using it as the responsive switch can leak desktop pills into the mobile row and displace `ListTrailing`.
- Truncation is for flexible text values such as names, phone numbers, email addresses, and locations. Fixed semantic controls—`Status`, `RelationshipStage`, pills, creator, and actions—must remain intact rather than compressing or splitting.
- When several values share a band, order them by importance so overflow removes the least important information first. Do not use horizontal scrolling to expose ordinary list metadata.
- The outer list remains one consolidated collection on mobile and desktop; do not switch between separate cards and a table at an arbitrary breakpoint.
- Mobile rows use slightly tighter vertical padding than desktop rows. Preserve the shared `py-2 sm:py-2.5` rhythm rather than overriding row height per feature.

The two divider colours are deliberately different: the darker `border-neutral-900` separates the primary and secondary bands within one record, while the stronger `border-neutral-800` separates records and matches the list perimeter. This alternating rhythm must remain visible on mobile and desktop.

### Interaction and exceptional state

- Every `ListItem` receives the shared subtle hover background so the active record is easy to track across a wide row.
- On mobile, `MobileListActionSurface` makes the entire item one accessible action target. Tapping anywhere opens the item's action popup; it does not navigate immediately. The canonical `Open …` action is first, followed by secondary and destructive actions.
- The three-dot `ListActionMenu` is hidden on mobile. From `sm` upward, the action surface disappears, the linked title is the default navigation affordance, and the three-dot menu is restored as the final element.
- List action popups use `AnchoredPopup`. They open directly above the pressed three-dot button or mobile action surface with a `6px` gap, align to its trailing edge, and stay at least `8px` inside the visible viewport. If vertical space is limited, the popup scrolls internally instead of crossing the top edge. They portal into the highest same-origin document with the platform popup stack level so list shells, sticky rows, and iframe boundaries cannot cover them.
- A popup closes after choosing an action, pressing its trigger again, clicking outside it, pressing Escape, navigating its owning frame, or switching away from its owning workspace tab. A parent-shell portal must never outlive the tab that opened it.
- Do not create page-local absolute dropdowns, below-first menus, or fixed coordinates for list actions. `AnchoredPopup` owns repositioning on scrolling, resizing, mobile visual-viewport changes, and trigger/content size changes.
- Destructive operations remain inside the action popup and keep their confirmation behaviour at every breakpoint.
- Creator avatars in lists use the stable, versioned `/api/profile-avatars/[username]` rendition rather than direct signed upload URLs. This keeps the displayed file small and cacheable across tab openings; do not restore per-render signed URLs in list implementations.
- A genuine failed or critical record may add a very faint semantic wash to `ListItem`, but this must not replace its `Status` or alter the standard geometry.

### Reference mappings

- Lead: owner and company; callability status; phone, source, industry, location, score; ID, created time, Betelgeze creator, actions.
- Poll: source summary; manual/automated label; poll status and duration; pipeline counts; ID, created time, creator, actions.
- Relationship: person and business; Test and lifecycle labels; work status; role, contact routes, location and assigned services; ID, updated time, creator, actions.
- Onboarding: person and business; Test/Stuck labels and onboarding status; step/submission/file counts and assigned services/modules; relationship ID, latest activity, creator, actions.
- Fulfilment: work-item title and operational status; attached relationship and concise work context; work-item ID, relevant time, creator, actions.
- Work Item: task title, Key task label, lifecycle stage and operational status; priority or concise description; work-item ID, relevant time, creator, actions. `components/list/work-item-presentation.ts` is the shared label/tone map for work-item statuses; list and detail views must use it together.
- Communication: person and business, channel label and latest-message status; one-line message preview and direction; relationship ID, latest-message time, actions.
- Appointment Setting: lead name and draft/submitted status; appointment time, meeting type and delivery feedback; appointment ID, updated time and actions. Use the shared List with Drafts, Upcoming and Past filters. Opening a record reveals its compact inline editor or submitted details below the two list bands; the editor is outside the mobile action surface. Client-configured fields belong in the editor, not additional scrolling columns. Keep appointment submission and notification delivery distinct, and keep an actively opened appointment visible after submission until the setter closes it or changes views.
- Admin Work Queue: work-item title and Admin work kind; queue priority status; concise queue rationale, effort, forecast and priority source; work-item ID, latest update, execution-owner assignee, actions.
- Maintenance: coded failure title, severity and Admin labels, work-item status; category, priority, occurrence count and first occurrence; work-item ID, latest occurrence, assignee, source and work-item actions.
- Activity: recorded event summary and category, truthful event-level status; event key, compact metadata and attached entity; event ID, occurrence time, actor or Betelgeze automation avatar, source and copy actions.

When a new list cannot fit this anatomy, first determine whether it is actually a list. Do not extend the standard merely to make galleries, timelines, settings rows, evidence disclosures, or nested planning structures resemble one.

The Assets gallery remains a gallery even though it shares the Library panel header, tabs, and `QuickStats` with Work Items. OKRs remain a nested planning workspace. Settings/source rows and onboarding-builder records remain configuration or authoring controls. None should be forced into `List` merely because they contain repeated records.

## Detail pages

A detail page is the canonical destination for one durable record. Relationship, onboarding, fulfilment, work-item, asset, poll, and activity-event detail routes share one visual sequence even though their content differs:

1. Mandatory `DetailPageHeader`.
2. Optional `DetailFields` when the record has attributes worth inspecting or editing.
3. Record-specific content such as a Gantt chart, onboarding timeline, asset preview, poll funnel, updates, or diagnostics.
4. Mandatory `DetailDangerZone` at the bottom of the primary content column for records that can participate in the shared archive lifecycle.

The record-specific middle remains flexible. The header, fields, and destructive-action anatomy do not.

### Progressive detail loading

- Start independent record queries together. Progressive rendering must not introduce an artificial header-then-fields-then-content request waterfall.
- During route navigation, retain a known record identity in `DetailPageHeader` when available and place `DetailFieldsLoading` directly beneath it. If no identity is known yet, show the compact opening label rather than a full-page generic skeleton.
- In the resolved route, keep the real `DetailPageHeader` outside the data boundaries. Give `DetailFields` the first meaningful `Suspense` boundary, followed by a separate boundary for record-specific content.
- Use `DetailContentLoading` for a heavier section such as a Gantt or onboarding timeline. The fallback identifies the pending section and reserves a modest amount of space; it must not imitate the entire final page or pulse every row.
- Each boundary reveals once. Do not replace already-resolved fields with a second intermediate state, and do not refetch shared data for a later boundary; create and share one promise instead.
- Keep `DetailDangerZone` last. A static danger zone does not need an artificial delay merely to make it appear later, but it must never block the header or fields from streaming.

### DetailPageHeader

```tsx
<DetailPageHeader
    category="Relationship"
    reference={shortId(relationship.id)}
    title={relationship.primary_person_name}
    subtitle={relationship.business_name ?? "No company saved"}
    labels={<SquarePill tone="yellow">Test</SquarePill>}
    facts={[{ label: "assets", value: 4 }]}
    updated="5hr"
/>
```

- The first line always identifies the record category and short ID in subdued monospaced text: `Relationship 69e381e`, `Poll e154d7a`, or `Asset c92f810`.
- String record names also supply the automatic workspace tab label. Relationship and work-item tabs use the name; onboarding, fulfilment, and appointment-setting details append their section. Communications tabs use `Chat · Name` for the active client, direct, or team chat, and `Communications` when none is selected. Explicit custom tab names take precedence.
- The record name is always `text-2xl`, semibold, and tightly tracked. Do not use a different title scale for a more complicated page.
- An optional subtitle gives one stable secondary identity, such as company, event key, or source context. It is not a description of the whole panel.
- The right-hand metadata rail is bottom-aligned with the identity block. Its order is key categorical labels, up to two short numerical facts, then `Updated …` as the final item.
- Header labels are reserved for meaningful classification or exception labels such as `Test`, `Stuck`, an asset kind, a manual poll, or a relationship lifecycle stage when that stage is not already obvious from the page. Use the shared `SquarePill` or `RelationshipStage`; do not hand-build a badge.
- Operational `Status` never appears in `DetailPageHeader`. It belongs in one `DetailField`, which is the page's canonical overall-status location. Do not repeat that same overall status in a content-block heading.
- Facts are optional, limited to two, and read value first (`2 assets`, `1m 42s duration`). Prefer facts that are not stated again below. If no unrepeated metric is useful, show only labels and `Updated …` rather than filling the rail for symmetry.
- Do not promote field values such as progress, trigger, source, or status into the header merely because there is room.
- On narrow screens the metadata rail moves below the identity, wraps between whole elements, and never splits a pill or status.
- The header owns its `border-neutral-800`, `pb-4`, and internal `gap-3`. A page must not wrap it in a second card, add another record title, or override its typography and spacing.

`DetailPageHeader` is distinct from `PanelTabHeader`: a panel-tab header names a workspace view or collection, while a detail header identifies one record. A detail route nested under a panel may retain the panel's shared tab navigation above it, but must not use a second panel heading as the record header.

### DetailFields

```tsx
<DetailFields>
    <DetailField label="Status" icon="status">
        <Status label="To do" tone="grey" />
    </DetailField>
    <DetailField label="Assigned to" icon="user" className="lg:border-l lg:pl-8">
        <Assignee name="Alex Morgan" avatarSrc={avatarUrl} />
    </DetailField>
</DetailFields>
```

- The fields block has the same background as the page and no outer border, rounded card, heading, or inset panel.
- It starts exactly `1.25rem` (`mt-5`) below the header and uses one column on mobile and two columns from `lg` upward.
- Every `DetailField` is a restrained row with a muted icon and label, a readable value, `min-h-10`, `py-2`, and a `border-neutral-900` bottom divider.
- Desktop rows use a fixed `9rem` label track; mobile uses `8rem`. Values take the remaining width and may contain text, inputs, selectors, shared pills, `Status`, `Assignee`, or a popup trigger.
- The second desktop column adds `border-l border-neutral-900 pl-8`. A full-width field uses `lg:col-span-2`. The page supplies only these placement classes; it must not restyle the row.
- Editable values remain visually quiet on the page surface. Popups may use their own bordered floating surface. Use established shared primitives inside values instead of local imitations.
- Every field popup uses `AnchoredPopup`, anchored to the exact pressed field value. It opens directly above that trigger, is clamped within the visible viewport, scrolls internally when space is constrained, and portals in front of page, shell, and same-origin iframe content. This placement is recalculated while the page, visual viewport, trigger, or popup changes size or position.
- Omit fields that do not apply. Do not render decorative empty rows to balance the columns.
- Long descriptions may span both columns. Record-specific analytical summaries such as poll funnel statistics remain content, not fields.

### Record-specific content

- Unique content follows the fields block at the normal `mt-5` or `mt-6` page rhythm and may use the surface best suited to its interaction.
- A relationship Gantt, onboarding timeline, asset preview, poll funnel, or diagnostic payload is allowed to retain its own internal design because it is not interchangeable record metadata.
- Do not repeat the record name, category, ID, overall status, or general details heading inside this content.

### DetailDangerZone

```tsx
<DetailDangerZone>
    <DetailDangerAction
        title="Archive relationship"
        description="Removes it from active lists while preserving its history."
        control={<DetailDangerButton>Archive relationship</DetailDangerButton>}
    />
    <DetailDangerAction
        title="Delete relationship permanently"
        description="This cannot be undone."
        control={<DetailDangerButton tone="delete">Delete permanently</DetailDangerButton>}
    />
</DetailDangerZone>
```

- The danger zone is the final block in the primary content column. Nothing ordinary follows it.
- It is one restrained red-tinted box: a low-opacity red-black background, muted red border, rounded corners, and small red heading. The treatment must read as a warning without becoming the visually loudest block on the page.
- Actions are vertically divided by subdued dark-red rules. Each row presents a title and concise consequence on the left and one fixed control on the right; controls stack below the explanation on mobile.
- Archive is always first and uses the quieter red-outline button. It removes a record from active views while preserving history and dependencies.
- Permanent deletion is always last and uses a slightly stronger dark-red filled button, never a bright solid red. Its wording must be explicit, and its confirmation must identify irreversible consequences and dependent records.
- Other destructive lifecycle actions, such as restarting onboarding, may sit between Archive and Delete and use the outline treatment.
- During the visual-definition phase, unavailable archive/delete actions remain visibly disabled with an honest explanation. Do not connect a destructive control to an unrelated mutation or imply that a placeholder works.
- Owner/admin visibility, confirmation, server authorization, archive persistence, restoration, and dependency-aware permanent deletion are functional requirements. The shared visual primitive does not replace them.
- Records that are deliberately immutable for audit or compliance may disable both controls pending a documented retention decision; they must not silently invent different danger-zone styling.

When the archive lifecycle is implemented, active lists exclude archived records by default and the proposed Library `Archived` tab becomes the shared restoration and permanent-deletion surface. That future behaviour must reuse the same archive terminology and must not change this visual contract without updating the components and this document together.

## TrendChart

`TrendChart` is the canonical compact time-series graph. It owns the chart geometry, white trend line, fading area gradient, axes, emphasized reference ticks, optional red exception bands, responsive labels, and keyboard/pointer tooltip behaviour. Feature code supplies normalized positions, numeric values, and already-formatted labels; it must not recreate the SVG treatment locally.

Use the neutral white line for ordinary measurements and activity volume. Use `tone="red"` only when the series itself measures errors or critical failures; it changes both the line and its gradient. Red bands mark exceptional or missed periods behind another series and do not change the meaning of the measured line itself.

```tsx
<TrendChart
    ariaLabel="Messages sent over the last 30 days"
    points={points}
    startPoint={{ position: 0, value: previousValue }}
    domainEnd={30}
    min={0}
    max={100}
/>
```

Pass `reveal` to animate the trend line and gradient together from left to right on mount. Key the chart by the selected period to replay this on range changes. Axes remain steady; reduced-motion preferences disable the animation.

Use `breakBefore` on a trend point when missing observations should interrupt the line and area. Do not turn periods with no denominator into a zero error rate.

## Workspace tab gestures

Mobile tab swipes scroll the strip. A stationary 650ms press lifts a tab for reordering; movement before the hold completes cancels drag activation. Desktop reordering starts after a short horizontal drag. Both use the same lifted preview outside the strip's clipping area, with a 140ms upward lift and subtle scale. Reduced motion uses an immediate offset. Drop and cancellation remove the preview immediately; taps, tab closing, and renaming retain their existing behavior.

## Operational responsibility controls

Settings > Teams uses the shared `Assignee` treatment with compact Seller and Manager checkboxes. Service eligibility is secondary text; permission controls and maintenance routing expand on demand. Do not present workspace authority (Owner/Admin/Staff) as interchangeable with these positions.

`DeliveryUserPicker` is the shared compact multi-user selector for service eligibility and optional client-chat participation. It uses `List` and `Assignee`, adds search for larger workspaces, and keeps the list height bounded. POS makes one selection per purchased service using a compact field. The client and internal group rosters use shared assignees; internal membership is read-only, while the client manager controls optional client-chat participants.

## Relationship context

The relationship context is a companion reference, not a record detail page or a collection of navigable records. The shell and standalone pages share `ShellRelationshipContextPanel`: company/contact identity and `RelationshipStage`, services paired with `Assignee`, saved relationship notes, actionable contact details, optional secondary metadata, and `QuickStats`. Attached services use `RoundPill`; missing ownership reads `Unassigned`. Hide absent optional contact and metadata rows. Never label a failed data load as an empty service list or unassigned team.

Keep permission-aware shortcuts outside the scrolling body. The Appointment Setting shortcut also requires a matching service and an eligible relationship. Service data respects the viewer's relationship/service scope. Use the existing relationship description as the notes source.

At `lg` and above, retain the desktop sidebar preference and reserve its width in the page. Below `lg`, context opens explicitly from the tab-bar icon in a modal drawer with native focus containment, Escape/backdrop dismissal, and focus restoration. Opening this drawer does not change the desktop preference. Close it on navigation, tab switches, and desktop resizing. Contact values wrap and offer link/copy actions with visible success or failure feedback.
