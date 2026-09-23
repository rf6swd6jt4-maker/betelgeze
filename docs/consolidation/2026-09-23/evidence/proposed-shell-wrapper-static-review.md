# Proposed shell wrapper: independent static review

Reviewed only as text: `docs/consolidation/2026-09-23/proposed-shell-commit-wrapper.patch` and `/private/tmp/be-consolidation-evidence/proposed-shell-wrapper-source.txt`. No patch application, candidate execution, production access, full test suite, or build was performed by this reviewer.

The candidate wraps all ten existing `prepareNativeLeave` call sites: browser history restore (candidate line 717), reopen (1122), open (1160), history traversal (1252), iframe-to-native navigation (1503), shell navigation (2047), tab switch (2118), add (2303), close (2356), and retry (2633). Their destructive state, ref, storage, direct frame navigation, and pruning operations are inside their callbacks. Speculative residency eviction is also enclosed (564-575). Failed confirmations do not fall through to destructive operations. The iframe-to-native callback ignores its boolean return, but performs no subsequent mutation outside the callback.

No new high-confidence control-flow regression was found in that wrapper text. This is not runtime or release approval. The existing functional `setTabs` updater in reopen still contains activation/storage side effects, and should be included in future React/StrictMode reopening fixtures; this is a pre-existing pattern, not a newly demonstrated failure.

## Remaining coverage gap

Native in-panel navigation does not use one of those ten call sites. `components/workspace/NativeWorkspaceTab.tsx:258-279` awaits `flushWorkspaceAutosaves`, then emits `navigation-start` or `location-replace`; it does not capture and confirm the owner at the actual React commit. Current `WorkspaceTopBarClient.tsx:1327-1362` handles native location replacement by updating `tab.url`, and current `:1490-1497` handles native navigation start the same way, outside `prepareNativeLeave`. Both remain unwrapped in the candidate text (1357-1391 and 1513-1532).

Thus this proposed wrapper alone cannot establish that edits made after an acknowledged flush are protected on native in-panel route transitions. It addresses the host-controlled callback set only. The current accepted source also retains the previously identified React scheduling gap between its final departure check and the actual destructive commit; this patch is unapplied.

Future authorized repair should include real React scheduling fixtures for late input after a successful flush, normal and replace navigation initiated inside native panels, shell route switches, close/retry/eviction, and reopened tabs. Static parsing and helper-only tests cannot establish React commit timing. Browser and physical-device behavior remain separate verification layers.
