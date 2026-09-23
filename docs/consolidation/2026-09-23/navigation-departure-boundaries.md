# Navigation departure evidence boundaries

This inventory distinguishes the approved local React-commit repair from pre-existing browser/Next navigation paths. It is not a claim of universal draft recovery. No live client editor was used as a fixture.

| Path | Owner and guarantee being checked | Separate limit |
| --- | --- | --- |
| Host closes an editor, changes renderer, or evicts a resident | `WorkspaceTopBarClient.prepareNativeLeave` acknowledges the current draft owner, validates it again, and must commit destructive React state changes before another input can run. | Exact owner/document identity, late mounts, superseded intents and failed saves need regression coverage. |
| Native panel initiates push or replace | `NativeWorkspaceTab.navigate` and the host's in-process navigation owner must share source/account/intent checks and one save attempt, with final validation at the destructive commit. | A native message must not remain an alternate unguarded route-changing path. |
| Native error-boundary Retry | The host requests explicit `PanelBoundary` retry; a changed route key can remove the old owner. | Resetting a boundary does not guarantee that a permanently rejected `React.lazy` module import can recover. Ordinary refresh retains the boundary. |
| Frame hard Retry or no-receiver fallback | `ensureTabFrameLocation` assigns/replaces the iframe location. The local departure check precedes that browser navigation. | `flushSync` does not synchronously finish a document request or run a final check at actual browser unload. A fixture replacing this operation with immediate React unmount would not prove the real behavior. |
| Legacy frame soft navigation | `WorkspaceTabFrameGuard` calls `createWorkspaceFrameNavigator`, flushes registered owners, then invokes Next's router inside `startNavigationTransition`. | Starting a transition is not its final route commit. Late edits during pending transitions need separate owner/checkpoint analysis; this continuation does not certify them safe. |
| External links, browser reload/close, out-of-workspace programmatic navigation | Browser document lifetime, with any editor-specific unload/checkpoint policy. | No universal draft unload guard was found. The React tab wrapper is not evidence for these paths. |

`RelationshipBackgroundEditor` registers a synchronous durable queue checkpoint and a `beforeunload` handler that refuses when checkpointing fails. `useWorkItemTextDraft` and `WorkspaceAutosaveForm` register in-app flushers but have no equivalent unload guard in their inspected implementations. Preserving their current code does not prove the same recovery guarantee for each editor. No new unload behavior or protected alerts behavior was introduced here.

React documents that [`flushSync`](https://react.dev/reference/react-dom/flushSync) can flush pending effects/updates, expose Suspense fallbacks and affect performance. It cannot be treated as a general navigation-completion API. The local repair therefore needs mounted React/Suspense/StrictMode checks and matched browser observations, with ordinary retained-owner navigation retaining normal scheduling where possible.

Before production promotion, test real mounted application navigation and explicitly resolve the uncovered legacy-transition/document-unload cases for editable routes. Keep physical Android/Chrome and iPhone/Safari/PWA evidence separate from desktop browser fixtures. No production benchmark writes or real client messages are test fixtures.
