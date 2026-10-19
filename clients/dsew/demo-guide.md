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

## 3a. On production (Vercel and Supabase), as of 2026-10-14

Demos live on the same stack as every Verity client: the Vercel app at `https://app.theverityai.xyz` and the Supabase
project, as their own tenant with their own Supabase login. They are synthetic and disposable.

- **Isolation:** the demo is a tenant like any other, walled off by row-level security. It cannot see or change another
  tenant's data. It does share the project's database connection pool and appears in HQ tenant lists, so it is flagged
  `customFields.demo = true` to be recognisable.
- **Create:** `NODE_OPTIONS="-r dotenv/config" npm run seed:dsew` with production env loaded. It creates the Supabase login
  `owner@dsew.demo` with a generated password, printed once. Share the password through a private channel; it is not stored
  in the repository.
- **Reset to clean:** `npm run reset:demo` is a dry run; add `-- --yes` to delete. It removes only a tenant flagged `demo` with the
  exact name `D & S Electric Works`, and its login if it belongs to no other tenant. Then run the seed again.
- **Migrations:** `20261014100000_capability_project` and `20261014110000_project_job_customer` are applied to production
  (additive; RLS enabled and forced on all ten new tables, checked).
- **Side effect on live clients:** manufacturing screens moved to a new "Production" sidebar group, so a live client with
  manufacturing active and read access now sees them (they were in a platform-only group before).
- A later demo for another prospect follows the same pattern: its own seed, its own flagged tenant, its own login.

## 3. Running it locally

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
- A job owner or salesperson (needs a schema change), a calendar view, notifications (ADR-039 outbox, not built).
- The customer-facing status page: a public read surface is a new security boundary and needs its own ADR before code.
- A first-class test report record (needs a schema change and design); testing today is the manufacturing QC checkpoints.

## 5. Hero journey, traveler and dispatch pack (added 2026-10-18)

All of this uses existing capabilities only. It does not show, and must not be described as, revisioned BOMs, controlled
documents, measured test readings with units and tolerances, Tally, Hindi or attendance. Every name, price, reading and
date is fictional demo data and the 100 kVA specification is illustrative until DSEW confirms its own.

**Seed:** `npm run seed:dsew-hero` (after `seed:dsew`). Idempotent, touches only the tenant flagged `demoFor = dsew`, and also
activates the Evidence capability for that tenant (needed to read test readings and, later, to capture them on a phone).
It adds *100 kVA cast resin dry-type transformer, hero journey* for the fictional Malwa Cement Works: two quote revisions,
approval, a production order from the 100 kVA BOM, six stages with five test checks and their readings, a published
verification passport, dispatch and delivery, five tasks, four milestones, time, costs, an advance and a final invoice with
receipts, then completion. It also adds a **late job** (Helmholtz coil pair, promised date passed, wire task blocked) for the
Summary. The existing electromagnet job (0.5 T lab magnet, urgent) is unchanged.

**Printables** (links on the order page, in the shell, with a Print button):
- `/manufacturing/{order}/traveler`: job card from the order's own materials, stages and checks, QR, blank lot/heat and
  sign-off boxes. The QR encodes only `{VERITY_PUBLIC_URL}/manufacturing/{order}`; a signed-out scan lands on sign-in, and
  sign-in does **not** return to the order (it opens the home page), so the phone should already be signed in.
- `/manufacturing/{order}/dispatch-pack`: delivery note, packing list, the checks that stand (the latest verdict per check,
  with the recorded reading where the reader may see Evidence), transport, delivery and a passport notice. Shown only once an
  order has been dispatched.

**Proven:** `src/test/capability-manufacturing-documents.test.ts` (7 tests: grants, latest verdict wins, undispatched has no pack,
another tenant's order is absent) and a `jobForOrder` assertion in `capability-project.test.ts`. Seen live at desktop and at
390 px, signed in; signed out the three URLs redirect to sign-in. The QR image was compared with the expected order URL.

**Known limits, not hidden:**
- Verified on a phone-sized browser window, **not on a real phone**; not printed on paper (print uses the same markup).
- The passport link is shown once and only its hash is stored, so the dispatch pack says a passport exists but cannot print its
  QR. The nameplate is printed from the link shown at publishing.
- Lot and heat numbers, package counts and weights are not recorded in Verity; the sheets leave space to write them.
- A check that needs evidence asks for a **photo link (a URL)**, not the phone camera (FINISHER P2-11). The seeded packing
  "photo" and readings are typed demo records that point at no image.
- A round floating chat button covers the bottom-right of "Start stage" on a phone.
- Tapping Pass opens a small form (remarks, photo link, Record pass); the result is recorded only after "Record pass".

Built 2026-10-15: edit a task or milestone (until it is done or reached), a Lost reasons screen (add, retire, restore, with a count
of jobs lost for each), a status filter on the Jobs list, and a "Next up" strip on every job.
- A first-class test report document. Today test results are the manufacturing QC checkpoints on the testing stage.
- The customer-facing job status page (the ADR-030 passport pattern could carry it).
- Invoicing and payments for a job (accounting and trading own those).
- Material cost is an estimate at each item's current average cost; issue movements do not snapshot a unit cost.
- The formal V1 gate: `obvious-basics-checklist` and the Odoo/ERPNext completeness cross-check, in the taskplan.
- manager.io structure is from general knowledge of the product, not a session with the owner.

**On-premise:** only the local rehearsal exists. Nothing here is validated on his server, and a private-network
install is Mode B, which ADR-031 does not yet promise. See `deployment.md`.

## 6. Added 2026-10-19, in answer to the client calls

Everything below was built, committed, tested and **opened in a browser against a local database and a local
object store**. None of it is on production, none of it is client-validated, and every name and number is fictional.

**What it shows, in the order to demo it**

1. **A document with a number he defines.** `/documents` > *Numbering*: add a type with a rule such as
   `IN-{SEG:client}{SEG:division}-{TYPE}-{SEQ:3}` and its codes. *New document* shows the number it will take; each
   client counts on its own. Search by number is the table's filter. Tiles count the real list; a lapsed document reads
   *Expired*, not *Released*. The exact scheme is still the client's to send: this one is illustrative.
2. **Revision control that answers "which drawing was used".** Open `IN-A3-DRG-001`: R02 is in force, R01 is superseded,
   and the job that relied on R01 is shown with *a newer release is in force; moving to it is a deliberate step*.
   Release is a separate permission; releasing your own work needs a dedicated grant and a recorded reason.
3. **A test report he can read in ten seconds.** Order page > *Test report*: the verdict first, each reading in its own
   unit against its accepted range, the condition it was taken under, and "recorded 2 times" on the insulation test that
   failed before drying. The unit is fixed by the check, so a value cannot be keyed in the wrong unit.
4. **The stamped project file.** Job page > *Project file*: cover, milestones, test report, delivery note and packing list,
   and photographs, one printable document ("Save as PDF" in the print window).
5. **Shop floor on a phone.** A check that needs a photo opens the camera and stores the photograph as evidence; a
   scan of an order QR while signed out returns to that order after sign-in; nothing floats over the Start button.

**To run it locally** (never against production without the product owner's say-so): a local Postgres with every migration,
Keycloak with realm `dsew`, `DSEW_OWNER_SUB` set, then `node prisma/run-seed.cjs seed-dsew.ts`, `seed-dsew-hero.ts`,
`seed-dsew-documents.ts` with `DATABASE_URL` and `DIRECT_URL` exported to the local database. **Do not use the `seed:dsew-hero`
npm script for this: it loads `.env`, which points at production. Likewise `next dev` fills any unset variable from `.env`,
so blank the Supabase variables explicitly, or the app binds production storage.** For uploads, point `VERITY_S3_*` at a
local S3-compatible server; the content-security policy admits that one origin.

**Known limits, not hidden**
- The camera was exercised through the same upload path with a file, **not on a real phone**; HEIC is converted by the
  browser's canvas, unverified on iOS.
- The demo documents' files are records that point at no stored bytes; opening them returns a signed link that resolves to
  nothing. Uploading a real file works.
- The project file lists photographs that have no stored image as "on record"; it never draws a picture it does not have.
- Document types and number rules are defined through the *Numbering* form; the client's real scheme, release authority
  and self-approval rule are still open (`decisions.md`).
- Not built: Hindi, a checklist builder the client uses himself, a two-way client portal, attendance, Tally.
- The migration `20261019120000_capability_document` is applied to the local database only. ADR-048 is still PROPOSED.
