# Task Plan 133 — Grow More Promotions: corporate-gifting campaign slice

**Authority:** Product-owner message 2026-11-06 naming Grow More Promotions (owner Abhishek Sharma) as a new client with a pasted
process analysis, then "go ahead" after `clients/grow-more-promotions/README.md` offered the reference audit and this plan. That
approves the audit and this plan only. It does not by itself authorise code: `CLAUDE.md` scope list still excludes CRM, sales,
procurement and inventory as finished business capabilities, and Task 129's demo-inventory note says new capability work needs the
owner's authorisation. Evidence: `clients/grow-more-promotions/README.md`, `clients/grow-more-promotions/reference-audit.md`.
Governing decisions: INV-001, ADR-017, ADR-019 (no second framework), ADR-005. Standing feedback: lean client builds, generic-first
placement, no client-named capability that must be restructured later.

## Status: PROPOSED 2026-11-06

Analysis and audit written. Nothing built. Blocked on: (a) the product owner's build authorisation, (b) the first meeting's answers
(README section 8) for the decisions in section 3 below.

## 1. Goal

One campaign, enquiry to delivery, runnable end to end by Grow More's staff on a seeded demo tenant: lead, quote built from a kit,
customer PO and advance, vendor PO and receipt, branding job with artwork approval and QC, dispatch to many recipients, invoice and
receipt, campaign margin. Done means DEMO-READY by the repo's own definition (seeded tenant, reset command, walked screens), not
"server tests pass".

## 2. Scope

In (proposal): the four things neither reference does, plus reuse of existing capabilities for the rest.

| Piece | Where it lives | Build or reuse |
|---|---|---|
| Lead, opportunity, lost reason | existing `outreach` / `crm` | reuse after a fit check (can a client tenant use it?) |
| Campaign (parent of quotes, POs, jobs, shipments), revisions, margin | new generic capability, working name `campaign` or an extension of `project` | build; decide in 3.1 |
| Kit template with costing | `ManufacturingBom` plus bought-in lines | extend |
| Vendor PO, receipt, reservation, GST invoice, payments | `trading` | reuse |
| Branding job, QC with photos | `manufacturing`, `evidence` | reuse; add artwork-approval gate |
| Artwork proof and customer approval | `document` revisions plus `approval` | small build |
| Recipient master, CSV import, validation | new, generic ("fulfilment recipient") | build; security design first (3.3) |
| Per-recipient shipment, manual carrier and AWB, status, POD | extend `manufacturing` dispatch or a generic shipment | build |
| Exception register (six types, owner, impact in money and days, escalation) | on the campaign; Task 90 may adopt later | build; see 3.6 |
| Margin floor and discount limit on the quote, proposer-not-approver rule | `approval` | reuse; check it can express the floor |

Out (explicit non-goals): RFQ comparison, vendor scorecards, demand forecasting, courier API, WhatsApp Business API, Tally sync,
payment gateway, e-invoicing, HR, advanced analytics. Each is deferred until the client asks and an integration decision exists.

## 3. Decisions to take before code

1. **Campaign placement.** Extend `project` (quote, job, milestones, cost entries already exist) or create a new capability.
   Default: extend `project` unless the fit check shows kit lines and revisions cannot live there without distortion. Must be
   generic, not "gifting".
2. **Revision model.** A revision is a new immutable version of the commercial terms with a computed difference against the
   previous one (quantity, price, BOM needs, what is already bought). Not cancel-and-amend. Decide whether this is a platform
   primitive or capability-local (Task 90 style rule: one real instance is capability-local).
3. **Recipient data boundary.** Who may read names, addresses and phones; vendors and couriers see only a fulfilment extract.
   This is a security boundary and needs an ADR before the recipient master (CLAUDE.md stop condition).
4. **Shipment shape.** Reuse manufacturing dispatch (one order, one trail) or add a generic shipment with parcels and an AWB, as
   ERPNext `Shipment` does. Default: generic shipment with parcels; courier adapter later.
5. **Unit of stock for kits.** Working answer 2026-11-06 (README section 9, supplied by the product owner, not yet client-confirmed):
   hybrid. Fast-moving components held in small stock; customised items bought against confirmed orders; stock checked before any
   purchase. Finished kits are assembled to order. Consequence: procurement is the campaign shortfall after reservation; receipt and
   inspection are skippable per line; executor (internal, vendor, partner) is recorded per activity; a shipment can originate at a
   vendor. Revisit only if the meeting contradicts it.
6. **Operational exceptions.** The owner's top requirement is early sight of delays with money and delivery impact, an owner and
   escalation. Six named types (vendor delay, late customer change, bad recipient data, branding inconsistency, late delivery,
   overdue payment), each its own record, not one status. Decide whether this is the Task 90 Attention primitive or capability-local;
   default capability-local on the campaign, built so Task 90 can adopt it. Approval segregation: the proposer of a discount, PO or
   invoice cannot approve it, even when one person holds several roles.

## 4. Stages

0. **Meeting** (no code): README section 8 asked of the client. Working answers exist since 2026-11-06 (README section 9, from the
   product owner, unconfirmed); the meeting confirms or corrects them, and also settles couriers, accounts package, headcount and
   current tools. Update README and this plan's sections 2 and 3 afterwards.
1. **Decisions and ADRs**: items 3.1 to 3.5; an ADR for the recipient boundary.
2. **Slice build**, in this order so each step is usable: kit and quote with revisions; customer PO and advance; vendor PO and
   receipt on `trading`; branding job with artwork gate; recipients and shipments; campaign margin.
3. **Demo tenant**: seed (invented client, vendors, products), reset command, route-walk and then a recorded walk, images through the
   image-gen workflow. Only then the word DEMO-READY.
4. **Second pass** after the client sees it: the deferred list in section 2.

## 5. Risks

- Scope creep from the pasted 14-stage ERP. Counter: this plan's non-goals.
- Overlap with `project`, `trading`, `manufacturing` produces a fourth parallel order concept. Counter: decision 3.1 and a fit
  check by opening existing screens before any schema.
- Recipient personal data. Counter: 3.3 before schema.
- Everything about Grow More's real process is unverified until the meeting.

## 6. Cross-references

Related, no supersession: Task 118 (manufacturing slice, design partner Carxen), Task 128 (CRM reference), Task 129 (demo
inventory and DEMO-READY definition), Task 131 and 132 (assistant over client data; semantic datasets would let the owner ask
"which campaigns run below 15 percent margin").
