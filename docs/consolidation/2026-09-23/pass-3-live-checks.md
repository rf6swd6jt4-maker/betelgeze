# Pass 3 read-only platform observations

The signed-in Supabase dashboard was inspected on 23 September 2026 for project `lhxrgapdrkwdaunwgeje`. All executed SQL was catalog-only `SELECT`; no migration, client-row write, worker invocation, restore or configuration change was executed.

- `select version()` returned PostgreSQL **17.6**, Linux aarch64, compiled with GCC 15.2.0. The local concurrency rehearsal uses PostgreSQL 17.11 on macOS arm64. It shares the major version, not the complete installed environment.
- `to_regclass('public.record_attachment_commands')` returned **NULL**. The local A4 receipt/command package is not installed under that expected relation name.
- A catalog-only inventory of the relevant tables and functions succeeded. The full-cell viewer showed `migration_registry: null`; this reconfirms the absent `supabase_migrations.schema_migrations` relation. A migration directory and SQL Editor history do not establish installed migration parity.
- The Pro dashboard showed scheduled physical backups through **23 September 2026 at 05:24:03 UTC**. The dashboard explicitly excludes Storage API objects. No Restore control was used. Backup availability is distinct from a completed restore and object-recovery rehearsal.

The native quick-query result viewer became stuck while displaying a large JSON cell. Reloading the dashboard recovered it. The inventory was then rerun in the full SQL Editor and returned one row. A schema-only CSV export reached Safari's site-download permission prompt. Permission was requested from the user but not received during this pass; the prompt was cancelled to defer the download without granting site access. Export and full parity review remain pending. No client rows or provider secrets were projected by this query.

No new live Lead Gen backlog, external scheduler/process, provider or R2 inventory is established by these observations. Earlier counts remain dated evidence, and the checked-in bounded diagnostics are available for the next authorized read-only check. No protected recovery scheduler was changed or manually invoked.
