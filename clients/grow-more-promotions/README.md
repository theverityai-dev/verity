# Grow More Promotions, New Delhi: business analysis and first-pass fit (2026-11-06)

Internal. Owner: Abhishek Sharma. What we know about the prospect, how their work maps onto capabilities Verity already has,
what is missing, and what to ask in the first meeting. Nothing here is built yet and no build is authorised (section 6).

## 1. Source and confidence

The only source is a desk analysis (pasted into the 2026-11-06 session, produced from the company website
growmorepromotions.com and its LinkedIn page). No meeting has happened. Treat every operating detail below as a hypothesis.

| Fact | Value | Confidence |
|---|---|---|
| Business | B2B corporate gifting: curated and customised merchandise, employee kits, bulk and multi-city delivery | From the website |
| Claims | 110+ vendors, 25,000+ kits delivered, bulk, multi-city and individual doorstep delivery | Marketing claims, unchecked |
| LinkedIn wording | Data verification, packaging and quality checks, real-time tracking, delivery confirmation | From LinkedIn |
| Owner | Abhishek Sharma | Given by the product owner |
| Not known | Headcount, whether they hold stock, who brands and assembles, courier partners, accounting tool, today's tools, pricing method | Unknown |

The pasted analysis also drew a full ERP (14 lifecycle stages, 15 modules, 5 phases). That is a reading of what a gifting business
could need, not what Grow More asked for. Do not take it as the requirement.

## 2. What kind of business this is

An aggregator-integrator, not a retailer and not a factory. Money is made on the spread between vendor cost and the corporate price,
and on never missing a dated delivery. The unit of work is a **campaign** (for example "ABC Technologies new-hire kits, 500 units,
8 cities, by 15 December"), not a sales order. One campaign can have several quotation versions, purchase orders to several vendors,
several branding jobs and hundreds of shipments. The three facts that make it different from the garment and timber clients:

1. **Kits.** A sellable thing is a bill of materials of bought items plus branding plus packaging.
2. **Many recipients.** Delivery is often one parcel per employee, from an uploaded sheet of names and addresses.
3. **Approval loops with the customer.** Artwork proof, then written approval, before any branding starts.

## 3. How the work flows (hypothesis, to confirm)

Enquiry (website, WhatsApp, referral) → qualify (occasion, quantity, budget per kit, cities, date) → curate a kit → quote →
negotiate → customer PO and advance → buy from vendors → receive and inspect → artwork proof and approval → brand → assemble and pack
→ dispatch (bulk, per office, or per person) → proof of delivery → invoice and collect → complaints, replacements, repeat order.

## 4. Fit against what Verity already has

Checked only at the level of model and file names in `prisma/schema.prisma` and `src/server/capabilities/`. No screen was opened,
so none of this is a claim that a flow works for them.

| Their need | Nearest existing capability | Fit (first view) |
|---|---|---|
| Leads, follow-ups, qualification | `outreach` (leads, opportunities, proposals, activities, tasks) and `crm` | Outreach is built for PlotArmour's own sales team; crm is guest-oriented. Needs a look before reuse |
| Quotation with versions, margin, GST | `project` (`ProjectQuote`, lines, jobs, milestones, cost entries, invoice, receipt) and `trading` | `project` is the closest shape for "a campaign is a job with a quote and cost entries"; check versioning and kit lines |
| Vendors, price lists, purchase orders, GRN | `trading` (suppliers, supplier prices, PO, GRN with gapless numbering) and `inventory` procurement | Strong. Partial receipt, and PO approval, to confirm |
| Stock, reservation, ledger | `trading` stock and reservation; `manufacturing` reservation | Strong. Reserved stock rule already exists |
| Kit as a BOM, assembly | `manufacturing` (`ManufacturingBom`, routes, operations, batch) | Good structural fit; BOM here is bought parts plus packaging, not raw material |
| Branding job with stages, QC with photos | `manufacturing` stages and checkpoint results, `evidence` | Good fit; artwork-proof approval loop is new |
| Approvals (discount, PO value) | `approval` | Fit, subject to the approval classes Verity already has |
| Dispatch, delivery trail, proof | `manufacturing` dispatch (one order, one trail) | Partial. Many parcels per order and courier tracking are new |
| GST invoice, payments, ledger | `trading` invoice, series, GST, payment allocation, ledger; `accounting` | Strong |
| Complaints and replacements | `complaint` | Fit to check |
| Documents (artwork, POs, POD) | `document` (types, revisions, links) | Fit |
| Assistant over their data | Task 131 agent, runs as the calling user (ADR-017) | Available as designed |

## 5. What is genuinely new (candidate gaps)

Each is a gap only if the meeting confirms the need. Listed so they are not discovered mid-build.

| Gap | Why it matters | Size |
|---|---|---|
| Campaign as the parent object, with a kit configuration and revisions | Quantity changes after buying are normal here; a revision must not overwrite the order | Medium |
| Kit template and customisation (logo, name, packaging) with costing | The quote is built from it | Medium |
| Recipient master with CSV or Excel import and validation (phone, PIN, duplicates) | Hundreds of individual deliveries per campaign | Medium |
| Shipment per recipient or per office, courier AWB and status, POD | Delivery is the promise they sell | Medium to large; courier APIs are an integration decision |
| Artwork proof and customer approval loop | Gate before branding starts | Small to medium |
| RFQ and quote comparison across vendors | Only if they actually run RFQs today | Small |
| Campaign profitability (quoted versus actual margin) | The owner's real question | Small once costs are tagged to the campaign |
| WhatsApp enquiry capture, Tally export | Where they work today | Integration decision; ask first |

Recipient personal data (names, addresses, phones) is a security boundary: vendors and couriers may see only what a fulfilment
needs. That needs a design decision before the recipient master is built.

## 6. Scope and authorisation

`CLAUDE.md` still lists CRM, Sales, Procurement, Inventory and Field Service as not in scope, and records that demo-inventory
breadth (Task 129) was authorised for specific capabilities. A corporate-gifting build is new capability work, so it needs the
product owner's explicit go-ahead before code. The standing client rules also apply: keep the build lean (minimum modules for this
client, not the full PRD), place new pieces at the generic capability level (campaign, kit, recipient, shipment are reusable by any
order-driven business, not "gifting-only"), and do the Odoo and ERPNext parity audit for this client's modules first
(`D:\Code\R&D\odoo-19.0`, `D:\Code\R&D\erpnext`).

## 7. Suggested lean first slice (proposal, not decided)

Enquiry-to-delivery for one campaign, using what exists: lead, quote with a kit BOM, customer PO and advance, vendor PO and GRN,
branding job with QC photos, dispatch to a list of recipients with a status per parcel, GST invoice and receipt, campaign margin.
Defer: RFQ comparison, vendor ratings, forecasting, courier API integration (start with a manual AWB field), WhatsApp API, Tally sync.

## 8. Questions for the first meeting

1. Do you hold stock, buy against each confirmed order, or both?
2. Is branding and kit assembly done in your own premises, by vendors, or both? Who packs?
3. Do vendors ship to you, or straight to the customer?
4. How is a quotation priced: fixed margin, negotiated per vendor, or by hand?
5. For a 500 to 5,000 recipient campaign, which couriers do you use and how do you track parcels today?
6. What do you use for accounts: Tally, another package, spreadsheets? Who raises invoices?
7. What happens when the customer changes quantity or design after you have bought?
8. How many people touch an order, and who does what? Does one person wear several hats?
9. Which tools do enquiries and follow-ups live in today (WhatsApp, email, sheets)?
10. What is the one thing that goes wrong most often (late vendor, wrong address, branding rejected, unpaid invoice)?

## 9. Working answers to the section 8 questions (2026-11-06, NOT from the client)

Supplied by the product owner as a recommended operating model. Wording in the source is "recommended", "proposed" and "requires
confirmation", so these are design assumptions to build the first demo against and to confirm with Abhishek, not what Grow More said.

| # | Working answer | What it means for the build |
|---|---|---|
| 1 | Hybrid: a little stock of fast movers, everything customised bought against confirmed orders; check stock before buying | Order shortfall = requirement minus available stock (existing `trading` reservation); buy only the shortfall |
| 2 | Hybrid: branding often outsourced, assembly, final QC and packing internal or at approved partners; owner named per activity per order | Each activity on a campaign carries an executor (internal or a named vendor/partner) |
| 3 | Both: usually via a central facility for inspect, assemble, consolidate; sometimes vendor ships direct | Receipt and inspection must be skippable per line; a shipment's origin can be a vendor |
| 4 | Negotiated vendor rate plus product margin plus manual adjustment; quote covers merchandise, branding, packaging, freight, tax, wastage; exceptional discount or low margin needs management approval | Quote is cost lines with a margin; a margin floor and a discount limit trigger an approval |
| 5 | Several couriers by destination, volume and deadline; bulk, multi-city and doorstep managed separately; AWB, per-recipient status, POD, exceptions in one place. Actual couriers unknown | Three dispatch modes; manual carrier and AWB first; courier adapters later |
| 6 | Central accounts team raises invoices and pays vendors; Tally Prime integration if they use it; sales may request an invoice but not authorise one | Invoice request from sales, issue by accounts; Tally export deferred until confirmed |
| 7 | Every change is an amendment with version history and approval; recalculate needs and commitments; show already-bought items and extra or cancellation cost to the customer before applying | The revision model in Task 133 section 3.2, with a "committed spend" figure |
| 8 | Eight functions (management, sales, procurement, inventory, production, quality, logistics, accounts); one person may hold several roles without losing approval segregation | Multi-role users; the person who proposes cannot also approve |
| 9 | One CRM for website, WhatsApp, email, phone, referral; history on the customer and opportunity | Manual logging first; channel capture later |
| 10 | Vendor delay, late customer change, wrong recipient data, branding inconsistency, late delivery, payment chase, each tracked as its own exception. Top requirement: see delays early, with money and delivery impact, an owner and escalation | A typed exception register with owner, due date, impact and escalation; fits Task 90 (Attention) |

Still unknown after this: headcount, which couriers, which accounts package, and what tools hold enquiries today. Those stay
meeting questions.

## Sources

- Company website: https://www.growmorepromotions.com/
- Desk analysis of the website and LinkedIn page, pasted by the product owner on 2026-11-06 (not independently checked).
