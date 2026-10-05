# Colonel Kebabz — inventory, stock ledger, stock count, wastage and transfers

Depth document for PRD §17–§20 and §27. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

## What the client asked for

- **§17 Inventory, outlet-specific.** Categories (meat, poultry, seafood, vegetables, dairy, spices, dry
  goods, sauces, packaging, beverages, cleaning, consumables). Track opening, purchases, transfers,
  consumption, wastage, adjustments, closing.
- **§18 Stock ledger** per item (opening, purchase, transfer, consumption, wastage, adjustment, closing).
  "No stock movement should happen without a transaction record."
- **§19 Stock count.** Daily, weekly, monthly, spot checks; full, by category or selected items; variance
  computed automatically.
- **§20 Wastage** with reason (10 listed), item, quantity, value, outlet, staff, time, **approval if
  required**, notes, photo.
- **§27 Transfers** HQ → outlet, outlet → outlet, main kitchen → outlet, warehouse → outlet:
  Request → Approval → Dispatch → Transit → Receive.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo **Inventory** (`odoo:stock/views/*.xml` menu items):

```
Inventory
├─ Overview                     one card per operation type (Receipts, Internal, Deliveries) with counts: ready, waiting, late
├─ Operations
│  ├─ Transfers: Receipts · Deliveries · Internal
│  ├─ Adjustments: Physical Inventory · Scrap
│  └─ Procurement: Replenishment
├─ Products: Products · Product Variants · Lots/Serial Numbers · Packages
├─ Reporting: Stock · Locations · Moves History · Moves Analysis · Valuation · Performance
└─ Configuration: Settings · Warehouses · Locations · Routes · Operation Types · Putaway Rules ·
                  Product Categories · Units of Measure · Scrap reasons · Storage Categories
```

ERPNext **Stock** workspace (`erpnext:stock/workspace/stock`): Item, Warehouse, Material Request, Stock
Entry, Stock Reconciliation, Purchase Receipt, Delivery Note; reports Stock Ledger, Stock Balance,
Stock Projected Qty, Stock Ageing, Warehouse-wise Stock Balance, Itemwise Recommended Reorder Level
(`erpnext:stock/report/`).

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions (state change) | Source |
|---|---|---|---|
| Odoo transfer (picking) | partner, source and destination location, scheduled date, operation type; lines: product, demand, quantity, unit | Mark as Todo (draft → waiting/confirmed), Check Availability (→ ready), Unreserve, Validate (→ done), Cancel, Return, Print, Put in Pack, Scraps | `odoo:stock/views/stock_picking_views.xml`, `odoo:stock/models/stock_picking.py` (states draft / waiting / confirmed / assigned / done / cancel) |
| Odoo Physical Inventory | editable list: product, location, on hand, counted, difference, assigned user, scheduled date | Request a Count, Apply, Apply All, Clear, History | `odoo:stock/views/stock_quant_views.xml` |
| Odoo Scrap | product, quantity, source location, scrap location, **scrap reason tags**, lot | Validate (posts move to scrap location) | `odoo:stock/views/stock_scrap_views.xml`, `odoo:stock/models/stock_scrap.py` (`scrap_reason_tag_ids`) |
| Odoo Replenishment | product, location, on hand, forecast, min, max, to order | Order, Automate, Snooze | `odoo:stock/views/stock_orderpoint_views.xml` |
| Odoo Moves History | every done move: date, product, from, to, quantity, reference | filter, group, export | `odoo:stock/views/stock_move_line_views.xml` |
| ERPNext Stock Entry | purpose (Material Issue, Material Receipt, **Material Transfer**, …), source/target warehouse, items, **add to transit** | End Transit (receive from transit), Fetch Items from Warehouse | `erpnext:stock/doctype/stock_entry/stock_entry.json`, `stock_entry.js` |
| ERPNext Material Request | type (Purchase, **Material Transfer**, Material Issue), items, required by date; statuses Draft → Pending → Partially/Transferred/Issued/Ordered/Received, Stopped, Cancelled | Stop, Re-open, create Stock Entry / Purchase Order | `erpnext:stock/doctype/material_request/material_request.json`, `material_request.js` |
| ERPNext Stock Reconciliation | items, warehouse, counted qty and valuation rate, difference | Fetch Items from Warehouse, submit | `erpnext:stock/doctype/stock_reconciliation/` |

### 4.3 Workflows

- **Internal transfer (Odoo):** Draft → Waiting → Ready → Done; with a transit location configured,
  two steps (dispatch to transit, receive from transit). Cancel and Return as exceptions.
- **Transfer (ERPNext):** Material Request (Material Transfer) → approval by workflow → Stock Entry
  (Material Transfer) to an in-transit warehouse → End Transit at the destination. Partial transfer
  updates the request to Partially Transferred.
- **Stock count:** Request a Count (assign user, date) → counted quantities entered → Apply posts the
  difference as an adjustment move (Odoo). ERPNext submits a Stock Reconciliation.
- **Wastage:** Odoo Scrap with reason tags; ERPNext Material Issue with a reason field per entry.

### 4.4 Reports

Stock on hand by location, moves history (the ledger), stock valuation, ageing, reorder recommendations,
inventory performance (`odoo:stock/report/`, `erpnext:stock/report/stock_ledger`, `stock_balance`,
`stock_ageing`, `itemwise_recommended_reorder_level`).

### 4.5 Configuration

Warehouses and locations (incl. transit and scrap locations), product categories, units of measure and
conversion, scrap reasons, reorder rules (min/max), cost method.

### 4.6 Automation

Reorder rules generate purchase or transfer requests; scheduled counts; late transfer flags.

### 4.7 Roles

Odoo Inventory User (operate) and Administrator (configure, apply counts). ERPNext Stock User, Stock
Manager; workflows add approvers.

## 5. Verity today

Evidence: `verity:src/server/capabilities/inventory/index.ts` (its header lists what is not built). The
capability registers a sidebar link `/inventory` (`index.ts` line ~428) **but no page exists** — the
link returns 404 (UI completeness audit, 2026-10-04). Note: the separate `trading` capability for Shree
Ganesh Timber has full stock screens (`/stock`, `/godowns` with receive, issue, transfer, adjust,
damaged, returned) on a different data model.

| Reference item | Verity equivalent | Status |
|---|---|---|
| Item groups (categories) and items with SKU, unit, reorder level | `create_item_group`, `create_item`, `set_item_active`; `/inventory` (2026-10-05) | Built (unverified on live data) |
| Stock per outlet | balance per item × `Location`; `/inventory` outlet switcher | Built (unverified) |
| Movement ledger: Receipt, Issue, Adjustment, Transfer | `record_stock_movement`; Receive / Use / Count on `/inventory`; ledger with running balance on `/inventory/[itemId]` | Built (unverified); Transfer not on screen |
| Consumption from sales | recipe `postConsumptionForOrder` on `settle_bill` | Built (no screen shows it) |
| Wastage with the 10 PRD reasons, value snapshot, notes, photo (evidence) | `record_wastage`; Waste on `/inventory`, 30-day log | Built (unverified); photo and approval not on screen |
| Stock count (full / category / selected) with variance | `apply_stock_count`; Count stock on `/inventory` | Built (unverified in browser) |
| Transfer request → approval → dispatch → transit → receive | `Transfer` is a single movement kind; no request, no transit, no receive | Missing |
| Opening / closing per period | not computed | Missing |
| Reorder alerts / replenishment | `reorderLevel` stored; no alert or screen | Partial |
| Unit conversion | `unitLabel` text only | Missing |
| Batch / expiry | none | Missing |
| Stock valuation | average unit cost on receipts | Partial |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| `/inventory` page: items list per outlet with on hand, unit, reorder level, value; item detail with ledger | **Include — first** | nav link is a 404 today; every backend action is unreachable |
| Item and category create/edit/deactivate on screen | **Include** | backend exists |
| Receive, issue, adjust actions on screen | **Include** | backend exists |
| Wastage form (reason, quantity, notes, photo) and wastage log | **Include** | backend exists; PRD §20 |
| Wastage approval above a value threshold | **Include** | PRD §20 "approval if required"; use the existing `approval` capability; threshold set by HQ |
| Stock count: full / category / selected items, counted vs expected, apply variance as adjustment | **Include** | PRD §19; prerequisite for the food cost variance report (menu document) |
| Opening / closing per period on the ledger | **Include** | PRD §17–18 example; derived from movements |
| Transfer request → approval → dispatch → in transit → receive (partial receive allowed) | **Include** | PRD §27 workflow; needs a transfer record with states (new entity inside `inventory`, not a platform primitive) |
| Reorder alerts on low stock | **Include** | `reorderLevel` already stored; notification engine exists |
| Unit conversion (purchase unit, stock unit, recipe unit) | **Include** | needed by recipes and procurement |
| Batch and expiry tracking | Defer | "Expired" is a wastage reason, but PRD does not require batch tracking; revisit for dairy/meat |
| Automatic replenishment (auto purchase/transfer from min/max) | Defer | alerts first; procurement document decides |
| Putaway rules, packages, routes, storage categories | Not applicable | single storeroom per outlet |
| Reuse `trading` stock screens directly | Not applicable | different data model built for plywood (ADR-018 extracts generic Trading separately); patterns reused, not code |

## 7. Verity design for this client

Inside the existing `inventory` capability; the transfer record is a new capability entity with a
state machine on the platform's existing State runtime (ADR-009 categories), so no platform change.

1. **`/inventory`** — outlet switcher; table of items (category, on hand, unit, reorder level, value,
   low-stock badge); per-row actions Receive, Issue, Adjust, Waste; header actions New item, New
   category, Start count, New transfer. Export.
2. **Item detail** — ledger with period filter showing opening, each movement (type, quantity, reference,
   who, when), closing; wastage history; recipes using this item.
3. **Wastage** — form (item, quantity, reason from the 10, notes, photo); value computed; above the HQ
   threshold the record waits in `/approvals`. Log page filterable by outlet, reason, period, with
   totals by value.
4. **Stock count** — choose scope (all / category / selected), print or enter counts on a phone,
   review expected vs counted with variance, Apply (posts adjustments, records who counted and who
   approved).
5. **Transfers** — request (from, to, items, needed by) → approve → dispatch (stock leaves source, held
   in transit) → receive (full or partial; shortfall recorded). States: Draft, Pending approval,
   Approved, In transit, Received, Partially received, Rejected, Cancelled.
6. **Low stock** — daily notification to outlet manager when on hand falls below reorder level.
7. **Units** — each item has a stock unit plus optional purchase and recipe units with conversion factor.

Open decisions: wastage approval threshold value; whether outlet → outlet transfers need HQ approval or
the sending manager's.

## 8. Acceptance

Module completeness bar (`docs/reference/module-completeness-bar.md`): `/inventory` resolves; all 8
inventory actions reachable; no internal identifiers; empty/error states; per-row actions; export.

Live walk-through on the Colonel Kebabz tenant (Defence Colony and Gurugram outlets):
1. Create category Poultry and item Chicken Breast (stock kg, recipe g); receive 40 kg at ₹220/kg.
2. Settle bills for 10 Seekh Kebabs; ledger shows recipe consumption in kg.
3. Record 2 kg wastage, reason Spoilage, with a photo; above threshold it waits for approval; approve.
4. Request 5 kg Defence Colony → Gurugram; approve; dispatch; receive 4.5 kg; shortfall recorded.
5. Run a category count for Poultry; enter counted quantity; apply; variance posted as adjustment.
6. Ledger for the day shows opening, purchase, transfer, consumption, wastage, adjustment, closing.
7. Drop below reorder level; the outlet manager receives a low-stock notification.
