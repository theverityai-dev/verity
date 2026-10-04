# Nonfunctional Requirements

## Security
Server-side authorization, tenant isolation, safe files, auditable state changes.

## Reliability
Explicit error states, safe retries, idempotency for retry-sensitive commands, deterministic demo reset.

## Performance
No unmeasured capacity promise. Optimize measured hot paths only.

## UX
Consistent navigation, forms, tables, status semantics, keyboard use for HQ and touch-first field flows.

## Maintainability
Canonical entities, no duplicated identity/tenant models, clear domain boundaries, tested state machines.
