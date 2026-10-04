# Work Lifecycle

## Happy Path
Order/Demand → Work Order → Schedule → Assign → Start → Execute → Complete

## Rules
- Each transition has an explicit next action and current status.
- Authorization is enforced server-side.
- Material actions are auditable.
- Failure preserves user data where safe.

## Acceptance
A trained persona can complete the journey without database intervention or undocumented workaround.
