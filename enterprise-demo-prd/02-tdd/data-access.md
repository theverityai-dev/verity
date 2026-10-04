# Data Access

Reads derive tenant context from authenticated identity/membership. Writes occur through commands or approved scheduled paths.

Queries must not rely on caller-controlled tenant IDs as authority. Detail endpoints must not expose cross-tenant existence.

Transactional truth remains relational; JSON is only for truly flexible attributes.
