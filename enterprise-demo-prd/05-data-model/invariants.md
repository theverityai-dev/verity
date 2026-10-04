# Data Invariants

- Tenant-owned records cannot be read/written outside authorized tenant scope.
- Core identities are canonical and not duplicated per module.
- Every child record references a valid parent when the business relationship is mandatory.
- State transitions cannot skip required approval/completion states.
- Stock-affecting movements are immutable history plus controlled balances/derived views.
- Audit records are append-oriented and attributable.
- Reporting records cannot mutate transactional truth.
