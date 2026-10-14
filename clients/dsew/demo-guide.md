# D & S Electric Works — Demo Guide

**Date:** 2026-10-14. Companion to `prd.md`, `phase-plan.md`, `deployment.md`.
Everything below ran on a throwaway local database and a local Keycloak. No live client data was touched.

## 1. What the demo shows

One Job per customer order, from enquiry to delivered, with the money worked out from real records.

| Screen | Route | What it proves |
|---|---|---|
| Summary | `/summary` | Order book, quotes out, new enquiries, late jobs, jobs in work, the stage each production order is at, milestones due, stock running short |
| Jobs | `/jobs` | Every job with status, priority, promised date, value, progress |
| Job | `/jobs/{id}` | Quote revisions, linked production orders and their stages, tasks with prerequisites, milestones, time, other costs, history |
| Production | `/manufacturing`, `/manufacturing/floor` | BOMs, routes, stage-by-stage production, QC checkpoints, dispatch |
| Stock | `/inventory` | Items, balances, purchase orders |

Seeded data (synthetic): nine jobs across every stage, three BOMs, two production routes whose testing stage carries
test checkpoints (ratio, insulation resistance, HV withstand, losses, temperature rise; field uniformity for magnets),
eleven stock items with opening cost.

## 2. Walkthrough (about ten minutes)

1. **Summary.** Order book and quotes out. Point at "Jobs in work" and the stage each order has reached.
2. **J-0006, NIT Bhopal (quoted).** Quote tab shows two revisions; the first is marked Replaced. Press
   *Customer approved the quote*: the job becomes approved and the agreed value is frozen from that revision.
3. Press *Start work*. Add a task ("Wind HV coils"), start it, mark it done: progress reaches 100%.
4. **Time tab, Log time.** 6 h at ₹600 becomes ₹3,600 cost and the margin recalculates at once.
5. **J-0001, IIT Indore (in progress).** Tasks wait on prerequisites; Production tab shows the six stages of the
   linked order; Costs tab shows where the cost comes from.
6. **J-0008 (lost).** The reason comes from a list, not free text. **J-0009 (finished)** shows a completed margin and is read-only.
7. **J-0007 (enquiry)** shows a job with no quote yet. **New job** opens one.
8. Phone: open the same pages at 390 px; the sidebar becomes a tab bar and tables become cards.

## 3. Running it

Needs Docker, Node, and the repo. Database: a disposable Postgres 16 on port 55432 with every migration applied
(`npx prisma migrate deploy`). Identity: Keycloak 26 with a realm `dsew` that has a client `verity-web`
(confidential, PKCE S256, redirect `http://localhost:3000/api/auth/oidc/callback`) and one user whose **id is a UUID**
(Verity requires a UUID subject; Dex's encoded subject is refused). Keycloak rejects `&` in a first name.

Environment for `npx next dev -p 3000` (real values stay out of the repo):

```
DATABASE_URL, DIRECT_URL        local database, runtime role verity_app
VERITY_AUTH_PROVIDER=oidc       VERITY_ENVIRONMENT=staging
VERITY_OIDC_ISSUER=http://localhost:8080/realms/dsew
VERITY_OIDC_JWKS_URI=http://localhost:8080/realms/dsew/protocol/openid-connect/certs
VERITY_OIDC_CLIENT_ID=verity-web   VERITY_OIDC_CLIENT_SECRET=<realm client secret>
VERITY_OIDC_AUDIENCE=verity-web    VERITY_OIDC_PRINCIPAL_CLAIM=sub   VERITY_OIDC_EMAIL_CLAIM=email
VERITY_OIDC_REDIRECT_URI=http://localhost:3000/api/auth/oidc/callback
VERITY_PUBLIC_URL=http://localhost:3000   VERITY_OIDC_SCOPES="openid profile email"
VERITY_SESSION_SECRET=<32+ random characters>
```

Seed: `DSEW_OWNER_SUB=<the Keycloak user's UUID> npm run seed:dsew`. It is not idempotent (a second run makes a second
tenant) and it waits out the platform's per-actor command rate limit, so it takes a few minutes.

## 4. Status, in the project's vocabulary

**BUILT and PROVEN (database tests, `src/test/capability-project.test.ts`, 6 pass):** the Jobs capability: lifecycle
and guards, quote revisions with the approved value snapshotted, task prerequisites and loop refusal, derived cost and
margin checked against hand-worked figures, void-not-delete for time and cost, tenant isolation.

**BUILT, clicked through live in the browser:** Summary, Jobs, job detail; new job, add quote (two lines, total checked),
approve quote, start, hold, resume, finish, add task, task start and done, add milestone, log time, add cost, void a cost.
Summary also checked at 390 px.

Added and clicked through on 2026-10-14: edit job, mark lost (reason from the list), cancel job, reach a milestone, void a
time entry, cancel a task, the customer list, a printable quote document, dark theme, 390 px width, and a confirmation step
before approving a quote, finishing a job or cancelling a task.

**Customer:** every job points at a customer record (the trading customer master, with GSTIN, phone and email); the name on
the job is a snapshot taken when it was opened. New job picks from the list, and New customer adds one. The job page links to the
customer and to "All jobs for this customer".

**BUILT, not clicked through:** link production order (database tests only; the seed leaves no free order).

**Completeness gate:** run, see `reference-parity/README.md` section 7.

**NOT YET BUILT:**
- Time entries linked to HR employees; the worker is a label.
- Edit a task or a milestone after creating it; a screen to define lost reasons (five are seeded).
- A job owner or salesperson, a calendar view, a status filter on the Jobs list, notifications.
- A first-class test report document. Today test results are the manufacturing QC checkpoints on the testing stage.
- The customer-facing job status page (the ADR-030 passport pattern could carry it).
- Invoicing and payments for a job (accounting and trading own those).
- Material cost is an estimate at each item's current average cost; issue movements do not snapshot a unit cost.
- The formal V1 gate: `obvious-basics-checklist` and the Odoo/ERPNext completeness cross-check, in the taskplan.
- manager.io structure is from general knowledge of the product, not a session with the owner.

**On-premise:** only the local rehearsal exists. Nothing here is validated on his server, and a private-network
install is Mode B, which ADR-031 does not yet promise. See `deployment.md`.
