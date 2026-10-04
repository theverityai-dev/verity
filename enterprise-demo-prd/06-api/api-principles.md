# API Principles

Commands = intent + validation + authorization + transaction + audit/events.
Queries = scoped read models with pagination/filtering.

Retries must be safe where duplicated effects are possible. Errors are structured and never leak another tenant's data.
