# Stylified proposal pack

Six documents in the Verity document theme (ADR-053 Obsidian, print edition), authored as HTML and printed to PDF.

| # | Source | PDF |
|---|---|---|
| 1 | `01-proposal.html` | `pdf/01-Proposal.pdf` |
| 2 | `02-mvp-build-and-demo-plan.html` (scope, screens and acceptance) | `pdf/02-MVP-Build-and-Demo-Plan.pdf` |
| 3 | `03-service-terms.html` | `pdf/03-Service-Terms.pdf` |
| 4 | `04-company-and-platform.html` | `pdf/04-Company-and-Platform.pdf` |
| 5 | `05-technical-solution-document.html` | `pdf/05-Technical-Solution-Document.pdf` |
| 6 | `06-acceptance-walkthrough.html` (every check to run, the figures to expect, a box to tick, the sign-off) | `pdf/06-Acceptance-Walkthrough.pdf` |
| all | assembled by the build script | `pdf/Stylified-Proposal-Package.pdf` |

Rebuild after any edit: `node clients/stylified/proposal/build-pdf.mjs` (needs Microsoft Edge or Chrome and an internet connection for the
fonts). The shared theme is `verity-doc.css`. `_package.html` is generated and can be deleted. The file names of document 2 keep their old
names so links and the build script stay valid; its title is "Scope, screens and acceptance".

## Commercial terms (2026-10-25, replaces the 2026-10-22 offer)

The owner set two options. Both include the same software and scope; only the way of paying differs. All amounts are plus GST.

| | One-time | Monthly |
|---|---|---|
| Option A, own it | ₹90,000 | ₹8,500 |
| Option B, start light | ₹25,000 | ₹12,000 |

Worked out, with break-even (A is cheaper in total from the 19th month) and the margin reading, in `../pricing.md`. The invoice amounts with
18% GST are in document 3, section 02 (A: ₹1,06,200 once and ₹10,030 a month; B: ₹29,500 once and ₹14,160 a month).

| Decision | Basis |
|---|---|
| Both options are plus GST, shown as plain figures | Owner's instruction 2026-10-25; the earlier "GST included" monthly figure is gone |
| Hosting: PlotArmour-hosted first (Verity's shared hosted deployment); a move to Stylified's own Vercel and Supabase accounts is a priced option offered later, **not promised** | Owner choice, 2026-10-22. ADR-054 parks client-owned cloud accounts (Mode D); `docs/deployment/client-owned-vercel-supabase.md` lists the open blockers |
| One-time fee invoiced 50% at kickoff and 50% on go-live | Our proposal, unchanged |
| Initial term 3 months **from go-live**, then month to month with 30 days' notice | Stated plainly in document 3 section 1 and as one factual line in document 1; no "commitment" figure is shown |
| Up to 10 named users, one unit | Our proposal; more are priced separately |
| Support hours, response targets, up to 4 hours a month of configuration, 7-day payment terms, liability cap of 3 months' fees | Our proposals in document 3, subject to legal review. Under Option A consider 2 hours (see `../pricing.md`) |

Not stated by the owner and therefore proposals to confirm: payment split, user limit, support hours, backup retention (daily, 30 days),
liability cap, governing law (Delhi courts), the 30-day validity.

## Documents follow the build

The pack says only what exists. Rewritten 2026-10-25 for the current build: fabric rolls, the lot rate card, scan, challans, the receiver's count,
cases, lot costing, team management, six roles, opening balances, Excel and PDF export; updated 2026-10-26 for joined lots with cost moved
between them, Today, Hindi on the munshi's and store's daily screens, and the Zebra file. Not claimed: Hindi on lots, costs, reports and
settings, a TSC file, a Zebra file proven on a printer, dispatch, WhatsApp or SMS, offline use, a Tally export. Hosted-workspace facts (photograph storage, a supervisor on a real phone, the
restore rehearsal) are stated as happening at go-live, not as done.
