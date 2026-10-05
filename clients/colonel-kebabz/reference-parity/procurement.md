# Colonel Kebabz — procurement, purchase orders, goods receipt and vendors

Depth document for PRD §21–§26. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

## What the client asked for

- **§21 Central procurement:** low stock → purchase request → approval → purchase order → vendor →
  delivery → GRN → inventory updated → invoice → payment.
- **§22 Purchase request** from an outlet manager: item, required qty, current qty, par level, reason.
- **§23 Purchase order:** vendor, outlet, items, qty, unit price, tax, total, expected delivery, payment
  terms, created by, approved by, status (Draft, Pending approval, Approved, Sent, Partially received,
  Received, Cancelled).
- **§24 GRN:** verify quantity and quality, record batch, expiry, actual price, accept/reject items,
  upload invoice, update stock; partial deliveries.
- **§25 Vendors:** name, company, contact, phone, email, address, GST, categories supplied, payment terms,
  rating, active; performance on price, quality, delivery time, rejection rate.
- **§26 Vendor price history** per ingredient per vendor over time, feeding food cost.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo **Purchase** (`odoo:purchase/views/purchase_views.xml` and menus):

```
Purchase
├─ Orders: Requests for Quotation · Purchase Orders · Vendors
├─ Products: Products · Product Variants
├─ Reporting: Purchase analysis (pivot/graph)
└─ Configuration: Settings (order approval, lock confirmed orders, bill control) · Vendor pricelists
```

Receipts are Inventory › Receipts (`odoo:stock`, see the inventory document); vendor bills are
Accounting › Vendor Bills (`odoo:account`).

ERPNext **Buying** workspace (`erpnext:buying/`): Material Request, Request for Quotation, Supplier
Quotation, Purchase Order, Supplier, Supplier Scorecard; Purchase Receipt (`erpnext:stock`), Purchase
Invoice (`erpnext:accounts`); reports Purchase Analytics, Purchase Order Analysis, Purchase Order Trends,
Item-wise Purchase History, Procurement Tracker, Requested Items to Order and Receive, Supplier
Quotation Comparison (`erpnext:buying/report/`).

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions (state change) | Source |
|---|---|---|---|
| Odoo RFQ / Purchase Order | vendor, vendor reference, order deadline, expected arrival, deliver to (warehouse); lines: product, qty, unit, unit price, taxes, subtotal; other info: buyer, payment terms | Send RFQ (draft → sent), Confirm Order (→ purchase, or → to approve above threshold), Approve Order, Send PO, Print, Create Bills, Lock/Unlock, Cancel, Set to Draft, Catalog (add products), smart buttons Receipts and Bills | `odoo:purchase/views/purchase_views.xml`, `odoo:purchase/models/purchase_order.py` (states draft / sent / to approve / purchase / cancel) |
| Odoo approval settings | Purchase Order Approval with minimum amount (double validation), lock confirmed orders | settings toggles | `odoo:purchase/models/res_company.py` (`po_double_validation`, `po_double_validation_amount`, `po_lock`) |
| Odoo vendor pricelist | vendor, product, price, minimum qty, lead time, validity dates | create, edit | `odoo:product/models/product_supplierinfo.py` |
| Odoo receipt | from PO; lines with demand vs received; backorder on partial | Validate, create backorder or not, Return | `odoo:stock/views/stock_picking_views.xml` |
| Odoo vendor bill | from PO; bill control on ordered or received quantities | Post, Register Payment | `odoo:account`, `odoo:purchase/models/purchase_order.py` (`action_create_invoice`) |
| ERPNext Material Request (Purchase) | items, qty, required by, warehouse; statuses Pending → Partially Ordered / Ordered / Received | create RFQ / Supplier Quotation / Purchase Order, Stop, Re-open | `erpnext:stock/doctype/material_request/` |
| ERPNext Supplier Quotation + comparison | quotes per supplier per item | compare report, make PO | `erpnext:buying/doctype/supplier_quotation`, `buying/report/supplier_quotation_comparison` |
| ERPNext Purchase Receipt | received, accepted, **rejected qty** with rejected warehouse, batch, expiry | make Purchase Invoice, Return | `erpnext:stock/doctype/purchase_receipt/` |
| ERPNext Supplier Scorecard | criteria (delivery, quality, price), weighted score, standing | evaluate periods | `erpnext:buying/doctype/supplier_scorecard/` |

### 4.3 Workflows

- **Odoo:** RFQ → sent → confirm → (to approve above amount → approve) → purchase order → receipt(s)
  (backorder for partial) → bill (on ordered or received qty) → payment. Cancel and return as
  exceptions; reorder rules create RFQs automatically.
- **ERPNext:** Material Request → (RFQ → Supplier Quotation) → Purchase Order (approval workflow) →
  Purchase Receipt with accepted/rejected quantities → Purchase Invoice → Payment Entry. Statuses on the
  PO track % received and % billed.

### 4.4 Reports

Purchase analysis by vendor, product, period; item-wise purchase history (price over time); procurement
tracker (request → order → receipt); requested items still to order or receive; supplier scorecard.

### 4.5 Configuration

Approval threshold, lock confirmed orders, bill control policy, vendor pricelists with lead times,
payment terms, taxes, units of purchase vs stock.

### 4.6 Automation

Low stock → RFQ (Odoo reorder rules; ERPNext auto Material Request from reorder level); approval
routing above threshold; late receipt flags.

### 4.7 Roles

Odoo Purchase User and Administrator (approves above threshold). ERPNext Purchase User, Purchase
Manager, Purchase Master Manager.

## 5. Verity today

Verity has a working procurement stack, but in the `trading` capability built for Shree Ganesh Timber,
not enabled for Colonel Kebabz: `/purchases` (`PurchaseDesk.tsx`, `NewPurchaseOrderForm.tsx`,
`[orderId]`), `/suppliers` (`SupplierList.tsx`, `[supplierId]`), commands in
`verity:src/server/capabilities/trading/orders.ts`. Its purchase lines reference **trading products**
(`productId`), not the `inventory` items that recipes consume — so it cannot receive chicken into a
Colonel Kebabz outlet's stock today.

| Reference item | Verity equivalent | Status for this client |
|---|---|---|
| Purchase request from outlet (qty, current, par, reason) | none | Missing |
| PO create / edit / submit / cancel | `create_purchase_order`, `edit_purchase_order`, `submit_purchase_order`, `cancel_purchase_order` (states draft → submitted → receiving → completed / cancelled) | Built in trading; not on inventory items |
| PO approval above a threshold | none on PO | Missing |
| Receive goods, partial receipt | `receive_goods` (`receiving` until complete) | Built in trading |
| Accept / reject quantity, batch, expiry, actual price on GRN | none | Missing |
| Upload supplier invoice on receipt | evidence capability exists; not linked to GRN | Partial |
| Purchase bill from PO, three-way match | `raise_purchase_bill_from_order`, `confirm_purchase_bill`, `purchase_match`, `purchase_review_queue` | Built in trading |
| Vendors with GST, payment terms, active | `create_supplier`, `edit_supplier`, `remove_supplier`, GST portal import | Built in trading |
| Vendor categories supplied, rating, performance (price, quality, delivery time, rejection rate) | none | Missing |
| Vendor price per item and history over time | `set_supplier_price` (current negotiated cost only), `purchase_analysis` | Partial — no history |
| Low stock → purchase request automatically | none | Missing |
| Purchase reports | `purchase_analysis`, `weekly_purchase_totals` | Built in trading |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Procurement for this client purchases `inventory` items, delivered to an outlet | **Include — needs an implementation decision first** (see §7) | without it, purchases never reach the stock that recipes consume, and §16 food cost cannot work |
| Purchase request (outlet manager) with par level and reason | **Include** | PRD §22 |
| PO statuses Draft, Pending approval, Approved, Sent, Partially received, Received, Cancelled | **Include** | PRD §23 names them; maps onto trading's states plus approval |
| PO approval above an HQ threshold | **Include** | PRD §21, §23 ("approved by"); existing `approval` capability |
| GRN: accept/reject qty with reason, actual price, invoice photo | **Include** | PRD §24; rejection feeds vendor performance |
| Batch and expiry on GRN | Defer | tied to the inventory batch decision (deferred there) |
| Purchase bill and payment from GRN | **Include** | PRD §21 ends at invoice and payment; reuse trading's bill flow |
| Vendor categories, rating, performance metrics | **Include** | PRD §25 |
| Vendor price history per item | **Include** | PRD §26; derived from receipt prices, feeds food cost |
| Low stock → draft purchase request | **Include** | PRD §21 first step; uses inventory reorder level |
| RFQ and supplier quotation comparison | Defer | not in PRD; vendors are fixed relationships at this size |
| Lock confirmed orders | Not applicable | covered by state machine (submitted orders are not editable) |

## 7. Verity design for this client

**Implementation decision required before building (stop condition: "would force a client-specific
fork"):** either (a) generalise trading's purchase lines to accept an `inventory` item and an outlet
destination, in line with ADR-018 (extract a generic Trading capability), or (b) add purchasing to the
`inventory` capability and reuse trading's patterns. Option (a) avoids two procurement stacks and is the
recommended path; it needs a short taskplan because it touches the Shree Ganesh flow.

Then, for this client:
1. **Purchase requests** (`/purchases/requests`): outlet manager raises item, qty, reason; current qty and
   par level shown automatically; low stock creates a draft request. HQ converts requests (several
   outlets, same vendor) into one PO.
2. **Purchase order**: vendor, deliver-to outlet, lines (item, qty, purchase unit, unit price, tax),
   expected delivery, payment terms; Submit → Pending approval above threshold → Approved → Sent
   (WhatsApp/email/print) → receiving → Received; Cancel with reason.
3. **Goods receipt** from the PO at the outlet: per line received, accepted, rejected (reason), actual
   price; invoice photo; posts `Receipt` movements to `inventory` in the stock unit; partial receipt
   leaves the PO open.
4. **Bill and payment**: trading's purchase bill and match flow, against accepted quantities.
5. **Vendor page**: categories supplied, payment terms, GST, rating; performance tab (price trend,
   on-time %, rejection rate) and price history per item.

## 8. Acceptance

Module completeness bar (`docs/reference/module-completeness-bar.md`), plus live walk-through:
1. Chicken Breast falls below par at Defence Colony; a draft purchase request appears; manager submits
   50 kg with reason "weekend demand".
2. HQ converts it to a PO for Vendor A at ₹255/kg; above threshold it waits for approval; approve; send.
3. Receive 48 kg accepted, 2 kg rejected (quality); actual price ₹258; invoice photo attached; stock
   rises by 48 kg; PO shows partially received.
4. Raise the bill against 48 kg; record payment.
5. Vendor A page shows price history (₹240 → ₹258), on-time and rejection rate; recipe cost for Seekh
   Kebab reflects the new average cost.
