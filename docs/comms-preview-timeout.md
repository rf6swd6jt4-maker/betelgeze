# Missing Comms previews: five-minute timeout

The live Safari desktop app recorded five preview requests lasting 300.186–300.260 seconds before failing. Vercel logs confirmed HTTP 504 runtime timeouts on both the attachment release and its predecessor. Two original files subsequently completed in 1.728 and 2.421 seconds. This is a small observed sample, not a platform benchmark.

The missing-preview branch awaited `response.body.cancel()`. Next.js tees GET response streams and retains a sibling, so cancellation can wait indefinitely on that sibling. The server never reached preparation or original fallback. Previous tests used null 404 bodies and skipped the problematic operation.

The fix initiates cleanup without awaiting the cancellation promise. Preview lookup and preparation share a 10-second deadline, passed through fetch and R2 SDK requests. Expiry aborts upstream work, destroys the original stream used for conversion, and releases preparation deduplication. Late preview responses are discarded. The authorized original has an independent stream lifetime. Prepared previews retain the existing one-request path; missing previews retain the three-operation repair path. No authentication, encryption, cache policy, admission queue, or UI changes are made.

Regression tests exercise Next.js's actual response cloning with a nonempty error body, delayed fetch/preparation, late results, successful response lifetime, and R2 generation abort/retry. The cloned-error regression fails on the old implementation before preparation is reached. Existing tests retain authorization, HEAD, validators, storage-denial, conversion-failure, and generated-byte delivery coverage.

The deadline bounds preview lookup and preparation, not authorization or the full transfer of an original file. It is a recovery ceiling, not a target latency. Rollback is an application commit revert; no schema or original attachment data changes are required. Production deployment and authenticated after-measurements are recorded separately in the release evidence.
