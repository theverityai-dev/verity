# Reporting

## Entities
ReportDefinition, Dashboard, WidgetDefinition, SavedFilter, ExportJob.

## Rules
- Preserve referential integrity.
- Tenant-owned entities follow existing RLS conventions.
- Derived reports are recomputable.
- State history must not be hidden solely in arbitrary JSON.
