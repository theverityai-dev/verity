# Flagship 10-minute Demo

## Happy Path
Executive dashboard → Customer → Opportunity → Quote → Order → Procurement → Stock → Work Order → Field Worker → Evidence → Quality exception → Resolution → Invoice status → Audit

## Rules
- Each transition has an explicit next action and current status.
- Authorization is enforced server-side.
- Material actions are auditable.
- Failure preserves user data where safe.

## Acceptance
A trained persona can complete the journey without database intervention or undocumented workaround.
