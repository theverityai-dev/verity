# Task Plan 46 — Enterprise Codebase Audit

**Phase 10 intake audit.** This is a red-team-style review of the actual
repository before any client-specific vertical work.

**Depends on:** the current repository state on `main` after pulling `origin/main`.
**Do not** treat architecture documents or intended behavior as proof of
implementation. Every claim must be backed by code, tests, or runtime evidence.

---

## 1. Objective

Audit the current Verity repository as if a major enterprise customer were
considering deployment tomorrow.

The question is not whether the system is elegant or directionally correct. The
question is:

> What would prevent us from responsibly deploying this codebase into a private
> enterprise environment right now?

The audit must identify concrete blockers, gaps, and residual risks across
security, multi-tenancy, authorization, audit integrity, APIs, input handling,
file handling, database correctness, transactions, concurrency, performance,
background jobs, secrets, error handling, supply chain, deployment hardening,
backup/restore assumptions, testing coverage, and architecture boundaries.

---

## 2. Audit Rules

1.  **Repository first.** Inspect the actual implementation, not the spec or
    the roadmap.
2.  **Evidence over assertion.** Every finding must cite file/line evidence,
    a test, a command result, or a runtime transcript.
3.  **Classify uncertainty honestly.** Every finding must be tagged as one of:
    `[OBSERVED]`, `[VERIFIED]`, `[INFERRED]`, or `[UNKNOWN]`.
4.  **No wishful closure.** A clean worktree, passing test count, or strong
    architecture doc is not proof that a control exists.
5.  **Separate UI from enforcement.** UI gating is not authorization unless the
    server enforces the same rule.
6.  **Distinguish current from target.** If a control is only partially present,
    say so explicitly.

---

## 3. Audit Integrity

Task 46 is an assessment task.

Do NOT modify production code to make findings disappear.

Allowed:

* temporary test files outside the production tree
* read-only inspection
* controlled proof-of-concept tests
* audit documentation

Not allowed:

* production fixes
* architecture changes
* dependency upgrades
* schema changes
* configuration changes intended to remediate findings

Every remediation must become a separately reviewed taskplan after Task 46 is
complete.

---

## 4. Audit Scope

### 3.1 Security

Inspect the current code for:

```text
authentication
authorization
tenant isolation
RBAC
session handling
OIDC
CSRF
XSS
SQL injection
command injection
file upload security
path traversal
SSRF
secrets
encryption
cookies
CORS
headers
rate limiting
error leakage
API exposure
```

Key question:

```text
Can one user ever access another organization's data by manipulating an ID?
```

### 3.2 Multi-tenancy

Trace actual request-to-database enforcement:

```text
Request
  -> Principal
  -> Organization / Tenant
  -> Authorization
  -> Service
  -> Prisma query
  -> Database
```

Record whether tenant scoping is:

* architecturally intended
* partially enforced
* fully enforced
* missing

### 3.3 RBAC

Audit every sensitive operation:

```text
create
read
update
delete
approve
export
upload
invite
configure
administer
```

Determine whether each is enforced at:

* UI
* API
* service
* database

### 3.4 Audit integrity

Inspect the mutation/audit trail around:

```text
domain_event
audit records
business history
approval history
status changes
financial records
inventory records
configuration changes
administrative changes
```

Questions to answer:

* Can historical records be modified?
* Can they be deleted?
* Can actor identity be forged?
* Can timestamps be manipulated?
* Are audit events transactionally coupled to the mutation?
* Can an admin silently erase history?

### 3.5 API security

Inventory every API endpoint and classify:

```text
Endpoint
Method
Authentication
Authorization
Tenant scope
Input validation
Rate limiting
Sensitive output
Mutation?
Audit?
```

Then separate:

* public endpoints
* admin endpoints
* internal endpoints
* webhooks
* file endpoints
* bootstrap endpoints
* health endpoints

### 3.6 Input validation

Audit every external input:

```text
query params
path params
body
headers
cookies
files
webhooks
imports
CSV
Excel
JSON
URLs
```

### 3.7 File security

Inspect:

```text
upload
download
signed URLs
file ownership
tenant isolation
MIME validation
file size
filename handling
path handling
malicious files
metadata
deletion
retention
```

### 3.8 Database architecture

Review Prisma schema and migrations for:

```text
indexes
foreign keys
unique constraints
cascade behavior
nullable fields
transactions
race conditions
N+1 queries
large queries
pagination
soft deletion
historical data
```

### 3.9 Transaction correctness

Find multi-step operations and classify whether they need:

```text
Prisma transaction
durable workflow
eventual consistency
```

### 3.10 Concurrency

Look for duplicate or racing writes:

```text
simultaneous approvals
simultaneous edits
duplicate submissions
double payment-like operations
duplicate jobs
duplicate webhooks
race conditions
```

### 3.11 Performance

Assess likely bottlenecks and scaling traps:

```text
N+1 queries
unbounded queries
missing pagination
large JSON responses
expensive joins
server-side rendering
client waterfalls
file handling
background jobs
database connection usage
```

### 3.12 Background jobs

Inspect actual usage of:

```text
emails
imports
exports
notifications
reports
long-running calculations
integration sync
file processing
```

### 3.13 Configuration and secrets

Audit:

```text
process.env
.env files
hardcoded secrets
default passwords
API keys
JWT secrets
database credentials
debug flags
development bypasses
```

Test:

```text
unset
empty string
invalid
malformed
production
development
```

### 3.14 Error handling

Check for safe external errors and useful internal diagnostics.

### 3.15 Dependency and supply chain

Inventory:

```text
npm packages
versions
licenses
known vulnerabilities
native dependencies
Docker base image
build dependencies
runtime dependencies
```

### 3.16 Deployment security

Audit the Docker and runtime posture:

```text
non-root
ports
filesystem
capabilities
secrets
environment
network
database exposure
storage exposure
debug mode
image reproducibility
healthcheck
startup
shutdown
```

### 3.17 Backup and disaster recovery

Verify application assumptions around:

```text
persistence
reconstructability
external dependencies
uploaded files
audit history
configuration
```

### 3.18 Testing quality

Classify coverage:

```text
unit
integration
API
authorization
security
database
E2E
deployment
regression
```

Then identify the most critical paths with no test coverage.

### 3.19 Code architecture

Verify that the implementation follows the intended layering:

```text
UI
  -> API
  -> Domain
  -> Platform
```

Flag violations such as:

```text
UI -> Prisma
Domain -> Supabase
Domain -> process.env
API -> direct infrastructure
business logic -> storage provider
```

### 3.20 Attack-path analysis

For every P0/P1 security finding, attempt to construct a realistic attack or
failure path:

```text
Entry point
-> attacker-controlled input
-> affected code path
-> authorization / tenant boundary
-> database / storage / action
-> resulting impact
```

Where practical, create a minimal reproducible test or runtime proof. Do not
exploit beyond what is necessary to establish the finding.

---

## 5. Deliverables

1.  A red-team audit document with findings table.
2.  A severity classification for every finding.
3.  A classification tag for every finding.
4.  A short list of unresolved questions and assumptions.
5.  A final deployment verdict: what blocks responsible enterprise deployment
    today, and what is only an improvement.
6.  `taskplans/46A_api_inventory.md`
7.  `taskplans/46B_sensitive_data_flow.md`

---

## 6. Finding Format

Each finding should be recorded in a table with at least:

| Area | Finding | Severity | Evidence | Classification | Recommendation |
| --- | --- | ---: | --- | --- | --- |

Severity scale:

* `P0` = cannot responsibly deploy
* `P1` = must fix before high-value production
* `P2` = should fix
* `P3` = improvement

Classification tags:

* `[OBSERVED]`
* `[VERIFIED]`
* `[INFERRED]`
* `[UNKNOWN]`

---

## 7. Acceptance Criteria

*   [ ] AC-01 The audit is based on actual repository evidence.
*   [ ] AC-02 Security, tenant isolation, and RBAC are checked separately.
*   [ ] AC-03 Audit integrity is checked separately from general logs.
*   [ ] AC-04 API inventory is produced with auth/scope/validation details.
*   [ ] AC-05 File handling is reviewed as its own risk surface.
*   [ ] AC-06 Prisma schema and migrations are reviewed for correctness risks.
*   [ ] AC-07 Transactions and concurrency are evaluated for race conditions.
*   [ ] AC-08 Configuration and secrets handling are tested for edge cases.
*   [ ] AC-09 Deployment hardening is checked against the actual runtime.
*   [ ] AC-10 Backup/restore assumptions are called out explicitly.
*   [ ] AC-11 Test coverage gaps are identified, not hand-waved.
*   [ ] AC-12 Findings are classified with evidence and uncertainty tags.
*   [ ] AC-13 P0/P1 security findings include an attack-path analysis when practical.
*   [ ] AC-14 `taskplans/46A_api_inventory.md` is produced as a separate artifact.
*   [ ] AC-15 `taskplans/46B_sensitive_data_flow.md` is produced as a separate artifact.
*   [ ] AC-16 Dependency evidence includes repository-compatible scans such as `npm audit` when available.

---

## 8. Expected Output Shape

The final audit should answer:

```text
If an enterprise customer asked for deployment tomorrow, what would stop us?
```

The answer must be direct, not promotional.

The final verdict must use three states:

```text
CAN DEPLOY TOMORROW
CAN DEPLOY WITH CONTROLLED CONDITIONS
NOT READY FOR ENTERPRISE DEPLOYMENT
```

Use those states to separate:

* no P0/P1 blockers
* known P1/P2 risks with explicit mitigation
* unresolved P0/P1 blockers requiring remediation
