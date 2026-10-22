# Stylified proposal pack

Five documents in the Verity document theme (ADR-053 Obsidian, print edition), authored as HTML and printed to PDF.

| # | Source | PDF |
|---|---|---|
| 1 | `01-proposal.html` | `pdf/01-Proposal.pdf` |
| 2 | `02-mvp-build-and-demo-plan.html` | `pdf/02-MVP-Build-and-Demo-Plan.pdf` |
| 3 | `03-service-terms.html` | `pdf/03-Service-Terms.pdf` |
| 4 | `04-company-and-platform.html` | `pdf/04-Company-and-Platform.pdf` |
| 5 | `05-technical-solution-document.html` | `pdf/05-Technical-Solution-Document.pdf` |
| all | assembled by the build script | `pdf/Stylified-Proposal-Package.pdf` |

Rebuild after any edit: `node clients/stylified/proposal/build-pdf.mjs` (needs Microsoft Edge or Chrome and an internet
connection for the fonts). The shared theme is `verity-doc.css`. `_package.html` is generated and can be deleted.

## Commercial terms and the reading we recorded (2026-10-22)

The owner gave: ₹25,000 + GST customization; server ₹4,500; maintenance ₹4,000; subscription ₹6,500 ("15k incl GST");
3-month lock-in.

| Decision | Basis |
|---|---|
| The three recurring amounts are monthly and add to ₹15,000 | 4,500 + 4,000 + 6,500 = 15,000 exactly |
| ₹15,000 is **per month, GST included** (₹12,711.86 + ₹2,288.14) | **Confirmed by the owner, 2026-10-22** |
| Hosting: PlotArmour-hosted first (Verity's shared hosted deployment); a move to Stylified's own Vercel and Supabase accounts is a priced option offered later, **not promised** | Owner choice, 2026-10-22. ADR-054 (PROPOSED) parks client-owned cloud accounts (Mode D) and bars proposals that promise it until the owner reopens it; `docs/deployment/client-owned-vercel-supabase.md` lists seven open blockers |
| If the move happens, provider bills stay inside the ₹4,500 server line (accounts in Stylified's name, billed to PlotArmour) | Owner choice, 2026-10-22. Provider floor per the research: Vercel Pro from $20 a month and Supabase Pro about $25 a month plus compute; we carry any excess, with 60 days' notice before changing the fee |
| One-time fee is ₹29,500 (₹25,000 + 18% IGST ₹4,500), paid 50% at kickoff and 50% on go-live | PlotArmour is registered in Delhi, Stylified is in Punjab, so IGST is expected. The 50/50 split is our proposal |
| Initial term is 3 months **from go-live** (the owner's "lock-in"); after it, month to month with 30 days' notice | Counted from the date the service starts. Stated plainly in document 3 section 1 and as one factual line in document 1; no "commitment" or ₹74,500 figure is shown |
| Documents are value-led and sell, per the owner (2026-10-22): "dont show it as commitments and dont highligh gst included figure, sole purpose of proposals and all documents is to attract and impress" | Document 1 shows ₹25,000 + GST and ₹15,000 a month as plain figures; the GST-inclusive wording is a footnote and the ₹29,500 invoice arithmetic lives only in document 3. Terms stay accurate everywhere (the initial term and GST are not hidden), and the "not claiming" list became "where things stand, and what follows" without claiming anything unbuilt |
| Up to 10 named users, one unit | Our proposal; more are priced separately |
| Support hours, response targets, 4 hours a month of configuration, 7-day payment terms, liability cap of 3 months' fees | Our proposals in document 3, subject to legal review |

Not stated by the owner and therefore proposals to confirm: payment split, user limit, support hours, backup retention
(daily, 30 days), liability cap, governing law (Delhi courts), the 30-day validity.

## Documents follow the build (2026-10-23)

After the floor was built, documents 1, 2 and 5 were edited to say only what exists: the roles matrix matches the seeded grants (a manager may record payments and sees wages; limits apply to approvals), "mark found" was dropped from the shortage register (a found piece is a manager reversal), the approval record is kept in the piece-rate capability rather than the platform approval substrate, the language is chosen per device, alerts are cards on My floor and in Approvals, lot pictures are set up with Stylified, and a defect photograph is added right after a return is saved.
