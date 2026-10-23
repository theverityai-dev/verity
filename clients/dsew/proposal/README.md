# DSEW proposal pack

Documents in the Verity document theme (ADR-053 Obsidian, print edition), authored as HTML and printed to PDF.

| # | Source | PDF |
|---|---|---|
| 1 | `01-proposal.html` | `pdf/01-Proposal.pdf` |
| 2 | `02-delivery-and-deployment.html` | `pdf/02-Delivery-and-Deployment.pdf` |
| 3 | `03-licence-and-ownership.html` | `pdf/03-Licence-and-Ownership.pdf` |
| 4 | `04-company-and-platform.html` | `pdf/04-Company-and-Platform.pdf` |
| 5 | `05-technical-solution-document.html` | `pdf/05-Technical-Solution-Document.pdf` |
| all | assembled by the build script | `pdf/DSEW-Proposal-Package.pdf` |
| recalculated | `recalculated-proposal.html` | `pdf/DSEW-Recalculated-Proposal.pdf` (stand-alone, not in the package) |

Rebuild after any edit: `node clients/dsew/proposal/build-pdf.mjs` (needs Microsoft Edge or Chrome and an internet
connection for the fonts). The shared theme is `verity-doc.css` (copied from the Stylified pack; each client folder owns
its copy). `_package.html` is generated and can be deleted. Images are in `assets/` (full size) and `assets/web/` (used by
the documents); prompts are in `assets/image-prompts.md`.

## The two commercial editions

| | Standard edition (documents 1 to 5) | Recalculated edition |
|---|---|---|
| Option 1, MVP (ex GST) | ₹3,25,000 | ₹2,40,000 |
| Option 2 and 3, Complete ERP (ex GST) | ₹4,80,000 | ₹3,80,000 |
| Testing period, per month (ex GST) | ₹8,500 | ₹8,500 (unchanged) |
| AI | Adapters inside every module; documented use cases in Options 2 and 3 | None; deferred, quoted on request |
| Workflow automation | Escalations, cross-module triggers, automated documents | Deferred; approvals and reminders stay |
| VM sizing | 4 vCPU, 16 GB; 32 GB with AI search | 4 vCPU, 16 GB |

### How the recalculated prices were derived (owner brief, 2026-10-23: MVP 240, Complete 380, ex GST; ₹8.5k a month kept)

Every reduction is a named removal, reconciled to the standard edition's own stated AI ranges (₹40,000 to ₹50,000 in the MVP,
₹80,000 to ₹90,000 in the Complete ERP):

| Removal | Option 1 | Option 2 |
|---|---|---|
| AI adapter in each module line (₹5,000 per line: 9 lines in the MVP, 15 lines in the Complete ERP) | 45,000 | 75,000 |
| AI adapter layer in cross-module integration and deployment (25,000 to 20,000) | n/a | 5,000 |
| Documented AI use cases (module 19, removed) | n/a | 15,000 |
| Workflow automation in module 18 (15,000 to 10,000; renamed "Notifications and approval workflows") | n/a | 5,000 |
| MVP re-pricing: modules 1 to 7 down 5,000 each (35,000) and the implementation lines down 5,000 together (requirements 2,000, testing 2,000, documentation 1,000, deployment unchanged); core quality and dashboards take only the AI cut; scope unchanged. Our allocation of the owner's 240 target | 40,000 | n/a |
| **Total** | **85,000** | **1,00,000** |

Check: 3,25,000 - 85,000 = 2,40,000 and 4,80,000 - 1,00,000 = 3,80,000. Dispatch (10,000) and Contracts (10,000) are
unchanged because they are already at the smallest module price. Payment keeps 30/30/30/10 (MVP 72,000 x 3 + 24,000;
Complete 1,14,000 x 3 + 38,000). Option 3 phases: 1,05,000 + 1,10,000 + 1,10,000 + 55,000 = 3,80,000.

The per-line allocation of the cut is ours (the standard edition never published per-module AI amounts, only the totals),
so a reader comparing line by line sees the allocation as a decision, not as a previously quoted figure.

## Reading and decisions recorded (2026-10-23)

| Decision | Basis |
|---|---|
| The standard documents follow the Stylified pack: HTML source in the Verity theme, imagery, one build script, a combined package | Owner: "update complete dsew proposal docs like we did for stylified" |
| Fees lead ex GST; GST (18%, IGST expected) is a footnote and a line in the payment section | The Stylified owner direction (2026-10-22): proposals sell; terms stay accurate and are not hidden |
| "Not claiming" wording became "Where things stand, and what follows" in documents 1 and the recalculated edition; the go-live gates and the production block are kept verbatim in substance | Same Stylified reading; nothing unbuilt is claimed |
| Timelines stay 6 to 8 and 8 to 12 weeks in the recalculated edition | Removing AI lowers scope risk, but the estimate depends on DSEW inputs; we do not promise a faster date |
| The recalculated edition is one stand-alone PDF; documents 2 to 5 remain the reference and section 12 of it lists what each one loses | Owner asked for "a new recalculated proposal pdf", not a second package |
| The Option 2 module count reads "18 operating modules" because line 19 (AI) is removed | The enquiry's 19 lines are kept numbered so the removal stays visible |
| Documents are dated 23 October 2026 | Date of this revision |

Not stated by the owner and therefore ours to confirm: the per-line allocation of the cut, the AI re-quote position
(deferred, quoted on request, no price promised), and the 60-day validity of the recalculated edition.
