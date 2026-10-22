# Demo readiness matrix

Task 129 workstream C. **DEMO-READY** means: a seeded demo tenant exists, a reset command restores it, and every screen of the
capability has been opened at desktop (1280) and phone (390) width, light and dark, with real data and no defect left unlogged.
Server tests alone never earn the word. This file records evidence; it does not assert it.

**Today one tenant is DEMO-READY: Stylified, on the local demonstration workspace only (2026-10-23, see its row). Not on a hosted workspace.** D & S Electric Works has been **ROUTE-WALKED** (below): every navigation route opened as that tenant's
owner at 1280 and 390, light and dark, on a local database, with no unlogged defect. ROUTE-WALKED is a step short of DEMO-READY on
purpose: it proves pages load and fit, not that the data tells a story, that the main flow works end to end, or that screens this
login cannot open (the "forbidden" ones) are fine. A person still opens each tenant's main flow before it earns the word.

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
| D & S Electric Works | project, manufacturing, trading, accounting, document, relationship (CRM), hr, evidence, inventory | `npm run seed:dsew`, then `seed:dsew-roles`, `-people`, `-profile`, `-billing`, `-ledger`, `-hero`, `-passport`; `seed-dsew-documents.ts`, `seed-dsew-crm.ts` | `npm run reset:demo` (dry run) then with `--yes`; flagged `demo=true` tenants only | **ROUTE-WALKED 2026-10-23**: 77 routes x 4 = 308 visits, 244 ok, 64 forbidden (16 plywood/trading routes DSEW's capabilities do not include), 0 failures. [Report](evidence/walk-d-s-electric-works-2026-10-22.md). Not covered: main flows, other roles |
| Colonel Kebabz | dinein (menu, bills, kitchen tickets, self-order), recipe, coupon, loyalty, finance, attendance, complaint, location | `prisma/seed-colonel-kebabz.ts` | no tenant-specific reset script; `reset-demo.ts` with `DEMO_TENANT_NAME` | never. **Cannot be walked locally yet:** its seed throws unless a live Supabase URL and service key are set (it creates a real login); DSEW and Stylified accept an OIDC subject instead |
| Stylified | piecework (lots, bundles, karigars, the floor: supervisor screens, approvals, day close), inventory style master | `prisma/seed-stylified.ts` (five logins: owner, manager, two supervisors, munshi) | `reset-demo.ts` with `DEMO_TENANT_NAME=Stylified`, then the seed: 81 s | **DEMO-READY on the local demonstration workspace, 2026-10-23.** Every route walked as all five roles at 1280 and 390, light and dark: owner 308 visits (289 ok, 16 refused as designed, 3 transient dev-server failures re-run clean), supervisor 32, manager 44, munshi 36, 0 failures; main flows (take back, photograph, deduction request, approve and decline, owner above the manager limit, Hindi) driven by script against local storage. Record: [acceptance record](../../clients/stylified/acceptance-record.md). **Not on a hosted workspace**: the hosted photograph run and the Supabase restore are open |
| Plywood demo | plywood, trading, location, asset, evidence | `npm run seed:plywood` | the seed deletes only the plywood capability's own rows for its tenant | never |
| PlotArmour Studio | outreach | `prisma/seed-pa-oms.ts` | `reset-demo.ts` with `DEMO_TENANT_NAME="PlotArmour Studio"` (needs the demo flag) | never |

Columns still to fill per walk: screens covered, widths and themes, open defects, evidence link. A row stays "never" until a walk
is committed.

## Capabilities with no demo tenant named above

`approval`, `billing`, `crm` (the older contacts capability, distinct from `relationship`), `scheduling`. Each is either exercised
inside one of the tenants above or not shown at all; the first walk of each tenant should settle which, and this section should then
be deleted.

## Known problems found while preparing this (fixed or open)

- **Found by the first real walk, 2026-10-23, all fixed:** the Import page crashed on first render (`IMPORT_KINDS`, a constant exported from a
  `"use server"` file, is not an array in the browser; every such export is now banned by `src/test/use-server-exports.test.ts`); the CRM
  Follow-ups page raised a hydration error because its day buckets depend on the viewer's time zone (it now renders once mounted); stat tiles let a
  figure like "₹88,69,250" run 39px past the tile (the figure now steps down with its length); a panel header with a filter and a button pushed the
  Customers card wider than a 390px screen (headers now wrap); an unbroken column list on Import ran past its card (hints now wrap).
- **How to repeat the walk locally:** seed on a local database with the production variables blanked, serve the app in OIDC mode, mint a session
  cookie for the seeded owner with the throwaway local secret, and run `npm run demo:walk`. The seed scripts load `.env` unless you set
  `DIRECT_URL` and `DATABASE_URL` yourself.

- **Fixed 2026-10-22:** the frosted blur was not rendering in Chrome, Edge or Firefox. A hand-written `-webkit-backdrop-filter` made
  the build drop the standard property; `getComputedStyle(...).backdropFilter` was `none` on every glass cell. Guarded by
  `src/test/css-backdrop.test.ts`. Any screenshot or contrast check taken in a non-Safari browser before this date was of the
  unblurred look.
- **Open:** low-end device performance is unmeasured. A scroll-frame test in headless Chromium showed no difference between full
  and lite because it has no GPU compositing; a real number needs a throttled trace on a real device or a GPU-backed profile.
