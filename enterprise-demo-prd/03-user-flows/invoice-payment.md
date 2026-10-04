# Financial Closure

## Happy Path
Eligible completion → Invoice → Issue → Payment status → Management view

## Rules
- Each transition has an explicit next action and current status.
- Authorization is enforced server-side.
- Material actions are auditable.
- Failure preserves user data where safe.

## Acceptance
A trained persona can complete the journey without database intervention or undocumented workaround.
