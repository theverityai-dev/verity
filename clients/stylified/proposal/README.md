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
| ₹15,000 is **per month, GST included** (₹12,711.86 + ₹2,288.14) | The owner wrote "(15k incl GST)" beside the three amounts. The proposal flags this and states the alternative (₹17,700 if the amounts were before GST) |
| One-time fee is ₹29,500 (₹25,000 + 18% IGST ₹4,500), paid 50% at kickoff and 50% on go-live | PlotArmour is registered in Delhi, Stylified is in Punjab, so IGST is expected. The 50/50 split is our proposal |
| Lock-in is 3 months **from go-live**; minimum commitment ₹74,500 including GST | Lock-in counted from the date the service starts. After it, month to month with 30 days' notice |
| Up to 10 named users, one unit | Our proposal; more are priced separately |
| Support hours, response targets, 4 hours a month of configuration, 7-day payment terms, liability cap of 3 months' fees | Our proposals in document 3, subject to legal review |

Not stated by the owner and therefore proposals to confirm: payment split, user limit, support hours, backup retention
(daily, 30 days), liability cap, governing law (Delhi courts), the 30-day validity.
