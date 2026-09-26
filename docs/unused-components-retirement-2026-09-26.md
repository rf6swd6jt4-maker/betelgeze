# Unused component retirement — 26 September 2026

Base: `e47eb20cc07a6c012a0599fd4ab6a3415da23737`. User authorized removal of the 13 audited candidates. Exactly 980 physical source lines are removed.

## Scope and callers

TypeScript static-import resolution and repository-wide symbol/path searches found no runtime callers, dynamic registrations, provider callbacks or command-line entrypoints for these files. They are ordinary components/helpers outside Next route conventions, not URL endpoints. Remaining references were source-inspection tests and dated documentation.

- `components/admin/DashboardAutoRefresh.tsx`
- `components/admin/DashboardMenus.tsx`
- `components/admin/FormResponsesSummary.tsx`
- `components/admin/ListToolbar.tsx`
- `components/admin/MetricTrendChart.tsx`
- `components/admin/RemoveInvoiceForm.tsx`
- `components/admin/WorkspaceOfficerSettings.tsx`
- `components/communications/composer-keyboard-slide.ts`
- `components/list/ListAutoRefresh.tsx`
- `components/onboarding-builder/SortableAuthoringList.tsx`
- `components/relationships/RelationshipAssets.tsx`
- `components/workspace/NativeAppointmentPanel.tsx`
- `components/workspace/RetentionRelationshipFields.tsx`

## Preserved owners and data

The current workspace shell/native-panel registry, list controls, shared charts, service/relationship views, onboarding builder and composer viewport/motion owners remain unchanged. These removals retire unmounted alternatives; they do not replace active implementations. Existing negative assertions prohibiting the obsolete keyboard hook and legacy form fields remain.

Only source-inspection assertions for deleted implementations were removed from four tests; all checks on surviving behavior remain. The older draft-recovery report now identifies the retired asset UI. The dated performance inventory remains historical evidence.

No routes, server actions, API handlers, dependencies, SQL migrations, stored URLs, records, assets, credentials, workers or accepted jobs are removed. Older deployments retain their own compiled code. Rollback is an ordinary revert of this cleanup commit; no data restoration is needed.

## Validation and size meaning

The release gate requires full tests, scoped lint/migration preservation checks, production build and the Foundations Chromium/WebKit suites on the exact candidate before main is advanced. Deployment evidence is reported separately. No physical-device behavior change is claimed. Removing unreachable source reduces maintenance surface; it does not establish a 980-line browser-bundle or runtime performance saving.
