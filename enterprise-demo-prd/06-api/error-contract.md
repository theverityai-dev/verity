# API Error Contract

Errors must expose a stable code, user-safe message, optional field details and correlation/reference ID.

Do not expose SQL, stack traces, credentials, secrets, or another tenant's records.

Examples: UNAUTHORIZED, FORBIDDEN, NOT_FOUND, INVALID_STATE, VALIDATION_ERROR, CONFLICT, DUPLICATE_REQUEST, DEPENDENCY_UNAVAILABLE.
