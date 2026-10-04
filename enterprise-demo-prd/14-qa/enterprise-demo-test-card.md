# Enterprise Demo Test Card

### Scenario
Sell → source → execute → assure → close.

### Actors
Sales, Procurement, Warehouse, Field Worker, Supervisor, Quality, Finance, Executive.

### Expected
Every step changes the correct records, respects permissions, updates downstream status and remains visible in audit/reporting.

### Negative checks
Unauthorized approval denied; cross-tenant record unavailable; duplicate action safe; invalid state transition rejected.
