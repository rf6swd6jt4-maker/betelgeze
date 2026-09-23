# Cancelled native reads and session churn

Base: `336439e4`. `WorkspaceRecordCache` previously aborted the transport and released its deduplication slot on invalidation/clear, but an upstream read that ignored abort kept the promise and its 30-second deadline alive. A burst of invalidations could therefore retain obsolete timers and continuations until their individual deadlines.

The cache now races explicit cancellation as well as its existing whole-read deadline, checks cancellation before dispatch, removes its abort listener and clears its timer on settlement. It keeps generation fencing, in-flight deduplication, authorized scope, cached-content preservation and explicit retry. Native consumers already treat `AbortError` as cancellation rather than a failed panel. No write/draft owner, database, polling cadence, subscription or alert behavior changes.

A deterministic 250-cycle experiment uses the actual transpiled baseline/candidate cache with a controlled timer port and abort-ignoring readers. Baseline: 0 settled reads, 250 retained deadlines, peak 250. Candidate: 250 settled reads, 0 retained deadlines, peak 1. This is a synthetic resource-lifecycle result, not proof of the original production slowdown's cause. A checked-in churn test verifies this behavior with real timer handles; existing tests cover stale response fencing, account clear, retry, cached refresh errors and mounted LRU entries. All 14 cache tests pass.

The audit retains intentional state: dirty recovery copies may outlive their owner when storage fails; mounted cache subscribers and accepted commands are not disposable merely to meet a memory target. Broader production long-session latency, memory, network and device behavior still needs measurement under representative use. The new browser CI covers composition/recovery regressions; it does not certify every workflow or a full working day.

Rollback: revert the cache change and its tests. There is no schema or stored-data change to undo.
