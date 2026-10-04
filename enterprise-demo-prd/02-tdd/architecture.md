# Architecture

Browser/PWA → Verity application → command/query layer → PostgreSQL → storage provider.

Cross-cutting platform: identity, authorization, tenant context, audit, scheduler, observability, storage.

Domain capabilities: CRM, Sales, Procurement, Inventory, Operations, Quality, Workforce, Finance-lite, Reporting.

No premature microservices or distributed infrastructure.
