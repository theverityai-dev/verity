# Demo readiness matrix

Task 129 workstream C. **DEMO-READY** means: a seeded demo tenant exists, a reset command restores it, and every screen of the
capability has been opened at desktop (1280) and phone (390) width, light and dark, with real data and no defect left unlogged.
Server tests alone never earn the word. This file records evidence; it does not assert it.

**Today nothing is DEMO-READY.** No demo tenant has been walked with the harness yet. The harness itself was proven on a throwaway
stack on 2026-10-22 (it caught a deliberate 404 and classed a locked screen as FORBIDDEN), so the next step is to run it, not to
build more.

## How to walk a tenant

1. Seed the tenant on a **local** database (never run the `*-hero` or `.env`-loading seed scripts against production: they load
   `.env`, which is production).
2. Sign in once in a browser context and save the session: `context.storageState({ path: "session.json" })`. The file holds cookies;
   delete it afterwards and never commit it.
3. `npm run demo:walk -- --base http://localhost:3000 --state session.json --tenant "<name>" --routes auto`
   (use `--resolve host=ip --insecure` for a local HTTPS stack). It writes one screenshot per route, width and theme plus a table to
   `docs/demo/evidence/`, and exits 1 if any route fails.
4. Fix what it finds in the shared primitives (`src/components/ui/primitives.tsx`, `globals.css`), not per page. Re-run.
5. Fill the tenant's row below with the date, the counts, and a link to the committed evidence.

What the harness judges: HTTP errors, uncaught page errors, console errors, sideways scrolling, and cards whose content is wider than
the card. What it cannot judge: whether the data makes sense, whether a capability is active for the tenant (an inactive screen
renders a polite page and passes), copy, and anything behind a button. A person still opens the main flow of each tenant before a demo.

## Demo tenants and how to restore them

Facts below were read from the repository on 2026-10-22; "last walked" is the only column that is evidence of a walk.

| Tenant (as seeded) | Capabilities it is for | Seed | Restore | Last walked |
|---|---|---|---|---|
| D & S Electric Works | project, manufacturing, trading, accounting, document, relationship (CRM), hr, evidence, inventory | `npm run seed:dsew`, then `seed:dsew-roles`, `-people`, `-profile`, `-billing`, `-ledger`, `-hero`, `-passport`; `seed-dsew-documents.ts`, `seed-dsew-crm.ts` | `npm run reset:demo` (dry run) then with `--yes`; flagged `demo=true` tenants only | never |
| Colonel Kebabz | dinein (menu, bills, kitchen tickets, self-order), recipe, coupon, loyalty, finance, attendance, complaint, location | `prisma/seed-colonel-kebabz.ts` | no tenant-specific reset script; `reset-demo.ts` with `DEMO_TENANT_NAME` | never |
| Stylified | piecework (lots, bundles, karigars), inventory style master | `prisma/seed-stylified.ts` | `reset-demo.ts` with `DEMO_TENANT_NAME=Stylified` | never |
| Plywood demo | plywood, trading, location, asset, evidence | `npm run seed:plywood` | the seed deletes only the plywood capability's own rows for its tenant | never |
| PlotArmour Studio | outreach | `prisma/seed-pa-oms.ts` | `reset-demo.ts` with `DEMO_TENANT_NAME="PlotArmour Studio"` (needs the demo flag) | never |

Columns still to fill per walk: screens covered, widths and themes, open defects, evidence link. A row stays "never" until a walk
is committed.

## Capabilities with no demo tenant named above

`approval`, `billing`, `crm` (the older contacts capability, distinct from `relationship`), `scheduling`. Each is either exercised
inside one of the tenants above or not shown at all; the first walk of each tenant should settle which, and this section should then
be deleted.

## Known problems found while preparing this (fixed or open)

- **Fixed 2026-10-22:** the frosted blur was not rendering in Chrome, Edge or Firefox. A hand-written `-webkit-backdrop-filter` made
  the build drop the standard property; `getComputedStyle(...).backdropFilter` was `none` on every glass cell. Guarded by
  `src/test/css-backdrop.test.ts`. Any screenshot or contrast check taken in a non-Safari browser before this date was of the
  unblurred look.
- **Open:** low-end device performance is unmeasured. A scroll-frame test in headless Chromium showed no difference between full
  and lite because it has no GPU compositing; a real number needs a throttled trace on a real device or a GPU-backed profile.
