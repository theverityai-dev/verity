# Grow More Promotions: Odoo 19 and ERPNext reference audit (2026-11-06)

Internal. Paired with [README.md](./README.md) (business analysis) and `taskplans/133_grow_more_promotions_corporate_gifting_slice.md`
(plan). Standing rule: for each client, read how Odoo and ERPNext actually serve the modules that client needs, then say what Verity
must provide. Parity is about user-facing completeness, not copying their architecture (INV-001 and the command write path stay).

## Method and limits

Read from source under `D:\Code\R&D\odoo-19.0\addons` and `D:\Code\R&D\erpnext\erpnext`: model files, view buttons, and doctype
field lists. No instance was run and no screen was clicked, so this lists what the code defines, not how it feels to use. Odoo's
sale-order buttons could not be pulled by pattern (the view file is structured differently from purchase); the sale flow below
comes from model names and method names (`action_confirm`, `action_quotation_send`, `_create_invoices`) and is less detailed than
the purchase side. Optional/upsell lines on a quotation were not verified.

## 1. Evidence by need

| Grow More need | Odoo 19 | ERPNext | What it tells Verity |
|---|---|---|---|
| Lead to won/lost with lost reasons | `crm`: stages, lost reasons (`crm_lost_reason_views.xml`), teams, activity plans, UTM campaigns | `crm`: Lead, Opportunity, Prospect, Sales Stage, Opportunity Lost Reason, Competitor, Campaign | Pipeline and lost-reason analysis are standard. Verity `outreach` already has leads, opportunities and proposals; reuse, do not rebuild |
| Quotation sent, valid until, then order | `sale` quotation, `sale_management` quotation templates (`sale_order_template`, template lines) | `Quotation` (`valid_till`, `amended_from`, discount, taxes, `order_type`), `Proforma Invoice` | Quote templates are Odoo's closest thing to a kit starting point. Both products amend a document by cancelling and amending; neither keeps a live revision history of one commercial thing |
| A kit sold as one item | `mrp` BoM type `phantom` ("Kit"): sold as one line, exploded into components at delivery | `Product Bundle` (new item code plus child items, active flag); `Sales BOM` | A kit is a BOM that explodes at fulfilment. This is the right model; Verity's `ManufacturingBom` can carry it |
| Buy from several vendors, compare | `purchase`: Send RFQ, Confirm Order, Approve Order (two-step), Acknowledge (vendor confirms date), Create Bills, Lock; `purchase_requisition`: alternatives and blanket orders | `Request for Quotation` (to many suppliers), `Supplier Quotation`, `Supplier Scorecard` with criteria and standings | Compare-and-pick is a real feature in both; vendor acknowledgement and a scorecard are separate steps. Verity `trading` has supplier prices and POs but not RFQ comparison |
| Reserve and pick stock | `stock` picking buttons: Check Availability, Unreserve, Validate, Packages, Scraps, Print | `Pick List`, `Stock Reservation Entry`, `Packing Slip`, `Packed Item` | Reservation already exists in Verity; picking by location is the part to check |
| Branding and assembly | `mrp` manufacturing order, work orders | `Work Order`, `Job Card`, `Operation`, `Routing`, `Workstation` | Verity `manufacturing` routes and operations cover the same ground |
| Quality checks with a template | `quality` is enterprise-only in Odoo | `Quality Inspection` with template, parameters and readings, tied to receipt and delivery | Template-driven inspection at receipt, in process and at dispatch is expected. Verity has checkpoint results snapshotted per order |
| Many parcels, courier, tracking | `delivery`: carriers, price rules, zip-prefix; `stock_delivery`: packages, package types, tracking on the picking | `Shipment`: pickup and delivery party, `Shipment Parcel` (length, width, height, weight, count), carrier, service, `awb_number`, `tracking_status`, `tracking_url`, linked delivery notes; `Delivery Trip` for own vehicles | The reference unit is one shipment with parcels, tracked by AWB. Neither handles "500 recipients from an uploaded sheet" as a first-class thing |
| Invoice and collect | `account`: invoice from order, payments, reconciliation | `Sales Invoice`, `Payment Entry`, `Payment Request` | Standard; Verity `trading` and `accounting` cover it |
| Customer complaint or replacement | Helpdesk is enterprise-only | `support` (Issue, SLA) | Small; Verity `complaint` exists |
| Landed cost, freight recovery | not in standard purchase flow | `Landed Cost Voucher` | Only if freight is billed back; ask in meeting |

## 2. What neither reference does (so Verity cannot copy it)

1. **Recipient master with bulk import and per-recipient fulfilment.** Both ship one party per shipment. A campaign with hundreds
   of employee addresses, validated by phone and PIN code, is built by hand in both.
2. **Artwork proof and customer approval as a gate** before a production job may start.
3. **A campaign as the parent** of quotes, vendor POs, jobs and shipments, with quoted-versus-actual margin per campaign.
4. **Non-destructive order revisions** that recompute material needs and report what was already bought. Both use cancel and amend.

These four are the product. Everything else is parity work and should reuse what Verity has.

## 3. Parity checklist for the first slice

Each line is a screen or action the reference has and Grow More will notice if missing.

- Pipeline board with stages, lost reason on loss, owner, next activity (Verity `outreach`; confirm it can be used by a client tenant).
- Quotation: lines from a kit, per-unit and total cost, margin, GST, validity date, send as PDF, version list.
- Customer PO number and advance receipt recorded against the order.
- Vendor PO: create from shortfall, send, vendor acknowledgement with a date, partial receipt, approval above a value.
- Receipt with incoming inspection and a reject path that keeps rejected stock out of usable stock.
- Stock: on hand, reserved to a campaign, available; reserved stock cannot be taken by another campaign.
- Branding job per product with artwork revision, stages, produced/rejected/pending counts, photos at QC.
- Kit assembly with component reconciliation.
- Dispatch: list of recipients or offices, packing verification, status per parcel, manual AWB and carrier, proof of delivery.
- Invoice, receipt, outstanding; campaign cost and margin on one screen.

## 4. Confidence

High that the reference models are as listed (read from source). Medium on fit to Verity capabilities (names only). Low on every
Grow More operating detail until the meeting.
