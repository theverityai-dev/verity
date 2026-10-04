# Background Jobs

Use the existing Verity scheduler where possible. Candidate jobs: quote expiry, overdue work reminders, low-stock warnings, approval reminders, daily snapshots and stale ticket detection.

Jobs must be idempotent where possible and must not put unnecessary tenant-sensitive data into global infrastructure tables.
