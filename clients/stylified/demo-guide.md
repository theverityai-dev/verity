# Stylified demo guide

Updated 2026-10-25 for the current build (rolls, rate card, scan, challan, cases, costing, team). Everything here runs on a throwaway local
database and a local Keycloak. Nothing here is on production. Every name, number and rupee is fictional.

## 1. What the demo shows

The flow in `flow.md`: rolls in, a lot with a rate card, a one-step cut into numbered bundles, scan out and scan in with the receiver's count,
a challan per handover, cases and charge requests for short pieces, wages from the rate card, lot cost, and a team the owner manages.

Seeded data (`prisma/seed-stylified.ts`): five stages with default rates, 14 rolls of fabric, five lots (LOT-0001 running with the sheet's own
reconciliation 100 = 94 + 2 + 1 + 2 + 1 open on B-0001, LOT-0002 draft, LOT-0003 closed, LOT-0004 on hold, LOT-0005 skipping the collar stage),
seven karigars under two supervisors (the helper is open to any), challans, open cases and charge requests, lot costs, an advance, a recovery, a
deduction and payments, three pending approvals and one closed day with a Hindi note.

## 2. Logins (local only)

Created by `bash scripts/demo-env.sh up`; all in the Keycloak realm `dsew` with the local-only password `Demo-1234`. See `docs/demo/test-logins.md`.

| Login | Role | What to show |
|---|---|---|
| `stylified-owner` | Owner | Factory dashboard, Team (add a person, stages, supervisor per karigar), production settings, costing, change history |
| `stylified-manager` | Manager | Approvals within the limit; "needs the owner" above it |
| `stylified-supervisor-a` | Supervisor: collar and cuff, stitching | Scan, My floor, give out, take back, cases, Hindi; sees only their own karigars |
| `stylified-supervisor-b` | Supervisor: pasting, button and kaj, finishing | A frozen day close; the write-off request |
| `stylified-munshi` | Munshi | Daily entry, lots, fabric, karigars, wages |

## 3. Walkthrough (about fifteen minutes)

This is the script in document 2, section 9 of the proposal pack.

1. **Fabric** (owner or munshi): receive three rolls, print the labels. Enter an invoice number received before: the warning appears.
2. **Lots**: new lot, set the rate card with one stage skipped, cut from the rolls, print the stickers (Slips, Sticker size).
3. **Scan** (supervisor, phone width): type or scan a bundle number, give out to a karigar, open the challan.
4. **Take back** 98 of 100: a case opens on the worker, a charge request goes to the manager.
5. Try to take back more than is out: refused with the figures.
6. **Approvals** (manager): approve a charge, decline a write-off.
7. **Lot cost** and a **karigar's account** (owner); download a report to Excel and compare the totals.
8. **Team** (owner): add a supervisor, give stages, set karigars under them; open that supervisor's list.
9. **Day close** with a Hindi note; as a supervisor try to open wages: refused.

## 4. Running it

```
DEMO_PORT=3100 bash scripts/demo-env.sh up            # start Docker, create and seed the database, create the logins, build and start the app
DEMO_PORT=3100 bash scripts/demo-env.sh up --reset    # throw the demo database away first and seed again (about 6 minutes)
bash scripts/demo-env.sh logins                       # print the logins
```

Reset one tenant only: `DEMO_TENANT_NAME=Stylified npx tsx prisma/reset-demo.ts --yes` (it deletes only a tenant flagged `demo` with that exact
name), then `node prisma/run-seed.cjs seed-stylified.ts` with the local database variables and the Supabase variables blank. Never run the seed
against production: it creates logins.

Things that trip people: a running server keeps the Prisma client it started with, so restart it after `prisma generate` or a migration; and
`prisma generate` fails to replace the engine file while a dev server holds it (the types are still written).

## 5. Status, in the project's vocabulary

- **BUILT and PROVEN:** the rules above, by more than 85 automated tests (`ledger.test.ts`, `capability-piecework*.test.ts`, `xlsx.test.ts`,
  `login-address.test.ts`, `import-list.test.ts`).
- **ROUTE-WALKED, DEMO-READY locally:** `acceptance-record.md` and `docs/demo/evidence/`. The newest screens (Team, karigar profile, import,
  opening stock) were opened at desktop and 390 px on 2026-10-25; the whole-route walk should be rerun before the next show.
- **NOT YET BUILT:** Hindi on lots, costs, reports and settings, a TSC label file (the Zebra file is built but not run on a printer),
  packing and dispatch (out of release one), WhatsApp or SMS, offline use, a Tally export. See `plan-to-mvp-and-complete.md`.
- **Not yet run on Stylified's hosted workspace:** photograph storage, a supervisor on a real phone, the restore rehearsal.
