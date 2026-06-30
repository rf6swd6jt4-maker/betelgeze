# Leadgen Contractors V1 Queries

Run these in Supabase SQL editor in order.

If you already ran an older copy of these files, rerun `01`, `02`, and `03`; they are idempotent and now also repair the missing phone-validation exposure and contractor mapping rows.

1. `01_source_catalog.sql`
2. `02_stage_capabilities.sql`
3. `03_icp_and_source_mappings.sql`

`04_optional_enable_recommended_sources.sql` is optional. It turns the new contractor sources on for existing workspaces; skip it if you want to enable them manually from the Sources tab.
