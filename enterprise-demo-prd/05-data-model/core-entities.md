# Core

## Entities
Tenant, Party, Person, Organization, User, Membership, Role, Site, Location, Product, Service, Unit, Attachment, Activity, AuditEvent.

## Rules
- Preserve referential integrity.
- Tenant-owned entities follow existing RLS conventions.
- Derived reports are recomputable.
- State history must not be hidden solely in arbitrary JSON.
