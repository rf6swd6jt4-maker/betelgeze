# Retiring runtime code

An unused export warning is not a deletion plan. Check route conventions, dynamic imports, command-line entrypoints, provider callbacks, older deployments, stored URLs and historical references. Preserve shared dependencies used by surviving features.

Record each removal group, its runtime/import callers, replacement or tombstone, retained data/provenance, dependency impact, regression evidence and rollback commit. Remove code in reviewable groups; retain immutable database migrations. Source bytes, installed package bytes and transferred browser bytes are different measurements.

For jobs, stop new admission before removing execution code. Repository removal cannot stop an older deployed worker or an already accepted provider request. Inventory external owners separately; do not disable unrelated recovery jobs. Retained archive access must keep its authorization and bounded reads.

Data deletion is a separate, explicitly authorized operation with an exact inventory and recovery plan. It is excluded from platform consolidation. A code rollback must not require deleting or reconstructing customer history.
