# URY vs Verity: capability comparison, A to Z

Written 2026-10-09. Reference system: URY (`D:\Code\R&D\ury-develop`, develop branch, Tridz Technologies,
MIT). Verity side: `D:\Code\verity` at commit `c1daa430` (main). Audience: the product owner and whoever
sequences Verity's restaurant work next.

## How to read this

Every row names evidence on both sides. URY paths are relative to `D:\Code\R&D\ury-develop`; Verity paths are
relative to `D:\Code\verity`. Where I did not open the code, the row says "not verified" instead of guessing.

Verdicts:

- **Verity ahead**: Verity has it, URY does not.
- **Parity**: both serve the need in a comparable way.
- **Partial**: Verity has part of it; the gap is named.
- **Missing**: URY has it, Verity does not.
- **Not in URY**: the capability comes from ERPNext underneath URY, not from the URY app.
- **Neither**: neither system has it.

This document records no decisions; section 4 proposes them. Which "Missing" rows are worth building is a
judgement against Verity's market (10 to 100 person businesses, lean V1), not a copy of URY's feature list.

---

## 1. What URY actually is

URY is a Frappe app that sits on top of ERPNext (`ury/hooks.py`: `required_apps = ["erpnext"]`). It adds 48
doctypes (`ury/ury/doctype/`) and customises ERPNext's `POS Invoice`, `POS Profile`, `POS Opening Entry`,
`POS Closing Entry`, `Item`, `Branch`, `Sales Invoice` and `Customer` through about 90 custom fields
(`ury/hooks.py` fixtures). It ships these front ends:

| App | Path | What it is |
|---|---|---|
| POS v2 | `pos/` (React) | Cashier desktop POS, plus a mobile "captain" mode (`pos/src/captain/`) |
| POS v1 | `urypos/` (Vue) | Older order-taker app, support ends December 2025 per `README.md` |
| MOSAIC | `mosaic/` (Vue) | Kitchen display, one URL per production unit (`/mosaic/<unit>`) |
| Self-order | `self-order/` (React) | QR table, QR pickup, kiosk and table-tablet ordering |
| Dashboard and reports | `frontend/` (React) | Owner dashboard, 18 report pages, setup wizard |

Everything URY does **not** build itself comes from ERPNext: items and item groups, price lists, stock and
warehouses, BOM, customers, suppliers, purchase orders, accounting, taxes, HR, payments, loyalty programs,
pricing rules and coupons. URY's own scope is the restaurant front of house, the kitchen, the daily P&L and
the report pack. Any "URY has inventory" claim really means "ERPNext has inventory and URY posts to it".

Verity is the opposite shape: every capability is native, tenant-isolated and permissioned. The restaurant
slice is `dinein`, `recipe`, `inventory`, `crm`, `loyalty`, `coupon`, `finance`, `hr`, `attendance`,
`scheduling` and `complaint` (`src/server/capabilities/`).

Headline result: **URY is stronger at the live restaurant floor and the kitchen. Verity is stronger at
everything behind the till** (procurement, stock control, guests, staff, money, tenancy, security, audit).
The three largest Verity gaps are the restaurant report pack, an outlet dashboard, and kitchen stations with
printing. Customer self-ordering is the largest feature URY has that Verity does not, but it needs an ADR.

---

## 2. A to Z

### A

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Aggregators (Zomato, Swiggy)** | Branch holds per-aggregator settings: customer, selling price list, mode of payment (`ury/ury/doctype/aggregator_settings`). Separate invoice series prefix (`URY Restaurant.aggregator_series_prefix`). Option to leave the aggregator invoice unpaid or bill without tax (`Branch-custom_make_unpaid`, `Branch-custom_no_taxes`). Aggregator order id on the invoice and the KOT. No live feed; orders are keyed by hand. | Order `channel = delivery_platform` with `platform` and `platformOrderRef` (`prisma/schema.prisma`, `DiningOrder`). Payment method `delivery_platform`. A `/platform-payouts` page reads the settlement CSV and flags paid-short, paid-more and missing orders (Task 125 item 4.2). Availability rules per channel. No per-aggregator price list, no tax-free toggle, no live feed. | **Verity ahead** on reconciliation; **Partial** on price list (see Menu) |
| **Alerts and red flags** | `get_needs_attention` (`ury/ury/api/ury_dashboard.py`): orders unpaid over 15 minutes, tables occupied over 60 minutes, KOT errors in the last hour, POS sessions left open from a previous day. A once-a-minute cron recreates KOTs that were never generated (`ury_kot_validation.py`). KOT-delay notification to chosen roles (`URY Notification Recipient`). Audio alert on a new KOT. | Prep-time clock on order lines with an `urgency` level on the kitchen board; `sweep_prep_breaches`; an "item ready" notification. HQ has a needs-attention list across clients, not inside an outlet. The notification outbox is ACCEPTED (ADR-039) but not built. | **Partial**. No outlet red-flag panel, no sound, no delay notification |
| **Approvals** | None in URY (ERPNext workflow only). | `approval` capability. Purchase order over ₹25,000 needs the owner; expense over ₹5,000 needs approval (`clients/colonel-kebabz/reference-parity/DECISIONS.md` #4). | **Verity ahead** |
| **Attendance and shifts** | Not in URY (ERPNext HRMS). | `attendance` capability: record, shifts, roster week grid with copy last week, payroll inputs (`src/server/capabilities/attendance/`). | **Verity ahead**; **Not in URY** |
| **Audit trail** | ERPNext document versions only. | Append-only activity stream, failed-command metadata (ADR-036), `/audit` page. | **Verity ahead** |

### B

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Bill** | The POS Invoice is the bill. A table invoice **must be printed before it can be submitted** (`ury/ury/hooks/ury_pos_invoice.py`, `validate_invoice_print`). After printing, removing items or lowering quantities is refused unless the POS Profile allows it (`validate_invoice`, `POS Profile-remove_items`). Invoice series per restaurant. Waiter order slip and merged-bill print formats. | Bill generated from a served order, taxes computed once and stored (CGST and SGST as basis points plus amounts), rounding, discount, several payments, settle, refund (append-only), browser print (`src/app/(shell)/counter/[billId]/BillView.tsx`). No "print before close" gate. **The bill's number is the first eight characters of its UUID** (`BillView.tsx`: `bill.id.slice(0, 8)`), not a consecutive GST serial; no seller GSTIN or FSSAI on the bill (ADR-040). | **Partial**. Verity ahead on refunds; URY ahead on numbering and the print gate |
| **Bill merge** | `merge_bills` joins several table invoices into one bill and prints `merged_pos_invoice_format` (`ury/ury_pos/api.py:1460`; `POS Invoice-custom_merged_pos_invoice`). | `merge_orders` merges orders into one (`verity.dinein.merge_orders`). | **Parity** |
| **Bill split** | Split groups by items or custom customer splits (`get_split_group`; `pos/src/components/BillSplitDialog.tsx`, `SplitGroupPanel.tsx`). | Pay-by-items split across payments on one GST bill (decision 2026-10-09: never several invoices); refund by items with part quantity (`BillView.tsx` split picker). | **Parity**, different rule: URY makes sub-invoices, Verity makes payments |
| **BOM** | ERPNext BOM. The daily P&L expands BOM sub-items and product bundles for cost of goods. | `recipe` capability: recipe per menu item, `get_recipe_cost`, food-cost variance (`verity.inventory.food_cost_variance`). | **Parity**; **Not in URY** |
| **Branch / outlet** | ERPNext Branch with a user table; only listed users can open that branch's POS (`Branch-user`). | `location` capability. Zones, tables, orders, bills and availability rules are outlet-scoped; a person is assigned to a location (`verity.location.assign_user`). | **Parity** |

### C

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Captain (order taker) mode** | Mobile captain app (`pos/src/captain/pages/CaptainTables.tsx`, `CaptainOrder.tsx`). **Captain transfer** hands an open order to another captain (`CaptainTransferDialog.tsx`, `POS Profile-transfer_role_permissions`). Roles can be barred from table orders. | The order pad works on a phone (`OrderPad.tsx`, 44pt targets). Orders record the taker (`takenByUserId`) but there is no command to hand an order to another waiter. | **Partial**. No captain transfer |
| **Cash and shifts** | **POS Opening Entry** per cashier with an opening balance per mode of payment and room; no table selection until one is open (`FEATURES.md`). Main and sub-cashier model (`Sub POS Closing`). **POS Closing Entry** reconciles expected vs closing per mode and shows the difference (`Sub POS Closing Payment`). | `/cash-reconciliation` is per outlet per day. Expected cash = opening + cash sales − cash refunds − cash expenses − withdrawn + cash in − cash out; cash in and out entries are append-only (Task 125 item 4.1). No per-cashier session, no per-mode count for card and UPI, no "must open a shift to sell" rule. | **Partial**. Day-level only |
| **Checklists (opening and closing)** | Checklist items per POS Profile. Opening or closing is blocked until mandatory items are ticked; logged with who and when (`URY Checklist Item`, `URY POS Checklist Log`, `submit_checklist`; `ChecklistGateDialog.tsx`). | The platform has a Checklist template kind (`TemplateDefinition`) and the trading side has a tax `closeChecklist`. No restaurant opening or closing checklist (PRD §56 to §57 listed as not built). | **Missing** |
| **Combos and bundles** | ERPNext Product Bundle; BOM expansion for cost; demo data ships `product_bundle.json`. | Not built. | **Missing** |
| **Complaints** | Not in URY (ERPNext Issue). | `complaint` capability: file, update status, resolve. | **Verity ahead**; **Not in URY** |
| **Coupons** | ERPNext Coupon Code and Pricing Rule. | `coupon` capability: create, apply on a bill. Coupons are not reversed on refund (decision 2026-10-09). | **Parity**; **Not in URY** |
| **Courses** | `URY Menu Course` has an icon and a **serve priority**. Items belong to a course; the POS sidebar groups the menu by course; the KDS can order items by course when "indicate in KDS" is on (`doctype/ury_menu_course`, `ury_menu_course_validation.py`). | Categories only. No course on a menu item or order line, no serve-priority sequencing at the pass. | **Missing** |
| **Customers and guests** | ERPNext Customer with `mobile_number`. Create from the POS. Favourites (top three ordered items). Repeated-customer report. | `crm` capability: guest list, 360 view, edit, merge duplicates, saved segments, birthday and consent (`verity.crm.*`). No favourite-items line found. | **Verity ahead**, except favourites |

### D

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Daily profit and loss** | `URY Daily P and L` is a submitted document per branch per day: gross sales, tax, net sales, cost of goods (BOM-aware), direct expenses (consumables priced per unit, fixed daily costs), electricity from opening and closing meter readings, indirect expenses (fixed, and percentage of gross or net sales), employee cost, depreciation, gross and net profit, each with a percentage (`doctype/ury_daily_p_and_l`, `ury_report_settings`). | `get_outlet_pnl` over any date range: revenue net of refunds, cost of goods from recipes (flagged approximate), expenses by category, labour line (permission-gated), contribution (`src/server/capabilities/finance/index.ts`). No meter-reading input, no per-day fixed-cost allocation, no percentage expenses, no depreciation, no daily lock. | **Partial**. Different shape; no daily allocation of fixed costs |
| **Dashboard (live)** | KPI tiles (today's sales, orders, average order value, active tables), needs-attention list, shift metrics (sales, covers, average per cover, average ticket minutes), baseline (median sales and covers for this weekday and hour over six weeks), floor load per waiter, service line (each table's stage: open, seated, fired, served, over), running-low items (`ury_dashboard.py`, `ury_service_line.py`; `pos/src/pages/Dashboard.tsx`). | Platform Overview and the counter's three tiles (orders awaiting a bill, bills open, outstanding). No restaurant dashboard with sales, covers, ticket time or floor load. | **Missing** |
| **Delivery and takeaway** | Order types Dine In, Phone In, Take Away, Delivery, Aggregators (`doctype/kds_order_type`). | Nine channels: dine_in, takeaway, phone, delivery, delivery_platform, website, qr, corporate, catering (`ORDER_CHANNELS` in `dinein/index.ts`). A channel order needs no table. | **Verity ahead** |
| **Discounts** | A switch on the POS Profile (`custom_enable_discount`). | `apply_bill_discount` by permission; coupons; loyalty redemption; no stacking (decision 6). | **Parity** |
| **Documents and licences** | Neither. | Neither (PRD §70 to §71 not built). | **Neither** |

### E

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Employees and payroll** | ERPNext HR. URY adds employee cost lines to the P&L settings (`employee_costs`). | `hr` capability: employees, departments, leave types and applications, salary behind its own permission (`verity.hr.compensation`), profile, payroll summary. | **Verity ahead**; **Not in URY** |
| **Expenses** | ERPNext journal and payment entries; fixed expenses typed into Report Settings. | `finance`: record, approve or reject, by category; feeds the outlet P&L. | **Verity ahead** |

### F

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Floor and table layout** | Rooms (AC or non-AC) group tables. A table has shape (rectangle, square, circle), x, y, width, height, seats and minimum seating. **Drag-and-drop layout editor on the POS.** Takeaway pseudo-table. Occupied flag and last-invoice time; attention colour after "Table Attention Time" (`doctype/ury_table`, `ury_room`; `LayoutView.tsx`, `TableCard.tsx`). | Zones and tables with seats, shape, x and y; editor at `/floor/setup`; five table states: free, seated, reserved, cleaning, out of service (`FloorPlan.tsx`). No width and height, no AC type, no minimum seating, no elapsed-time badge on a table card. | **Partial**. Verity has richer states; URY has richer geometry and timers |
| **Food cost** | Daily P&L cost of goods; "Item wise purchase history" report. | Recipe cost, menu engineering (Star, Plow Horse, Puzzle, Dog) at `/recipes`, food-cost variance (theoretical vs counted). | **Verity ahead** |

### I

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Inventory and stock** | ERPNext stock. Each production unit names a warehouse; the POS invoice updates stock on submit. "Running low" list on the dashboard. | Native `inventory`: items, groups, ledger, stock on hand, wastage, stock count with apply, transfers between outlets, stock requests, low-stock draft order. | **Verity ahead**; **Not in URY** |
| **Internationalisation** | POS v2 ships `en`, `fr` and `ar` locale files and right-to-left layout (`pos/src/i18n/locales/`). | No i18n library in `package.json`; English only. | **Missing**; matters only for a client outside India |
| **Invoice numbering** | Series prefix per restaurant and per aggregator. Order number resets daily when the POS Profile says so (`custom_reset_order_number_daily`, `ury_kot_order_number.py`). | Not verified for bills. | **Not verified** |

### K

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **KOT (kitchen order ticket)** | A KOT is a submitted document with a type: New Order, Order Modified, Partially cancelled, Cancelled. Items show ordered and cancelled quantity. Order-level and item-level comments. Prints at the production unit's printers; reprint on demand (`ury_kot_generate.py`, `ury_kot_reprint.py`, `FEATURES.md`). | No KOT document. The kitchen reads order lines directly; a late addition is new queued lines; a void is a line state with a reason. No ticket print, no reprint. | **Partial**. Fewer artefacts, no paper |
| **Kitchen display** | MOSAIC per production unit: live cards, colour-coded (white table, blue takeaway, orange modified, red cancelled), timer with a warning time, audio alert, serve and un-serve, confirm cancellation, filter by order type per unit (`ury/ury/api/ury_kot_display.py`, `mosaic/`). | `/kitchen`: columns Queued, On, Ready to go; one tap advances a line; urgency from the prep clock (none, low, medium, high, critical, breached); refresh every 10 s; notes and add-ons shown (`KitchenBoard.tsx`). No station filter, no sound, no serve or bump back, no order-type colouring. | **Partial** |

### L

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Loyalty** | ERPNext Loyalty Program. | `loyalty`: earn per ₹100, redeem at the counter in one tap, append-only ledger, points follow refunds, merged guests. | **Parity**; **Not in URY** |

### M

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Menu** | `URY Menu` per branch, linked to a price list. Rows carry rate, a **special dish (priority)** flag, a disabled flag and a course. Variants and add-ons are child tables on Item (`doctype/ury_menu`, `ury_menu_item`, `item_add_on`, `pos_item_variants`). **Room-wise menu** and **order-type-wise menu**: a different menu, hence price list, per room or per order type (`URY Restaurant.room_wise_menu`, `order_type_wise_menu`). | Categories, items, portions (price delta), **add-ons** with price (Task 125 item 3.1), **availability rules** by outlet, channel and time window with a stated reason on the pad (3.2, 3.3), **price history** from the audit trail (3.4), retire instead of delete. One price per item; no per-room or per-channel price; no priority or special flag; no item photo (`MenuItem` has no image column). | **Partial**. Verity ahead on availability and history; URY ahead on per-room and per-order-type pricing and priority items |
| **Menu engineering** | Item-wise sales report only. | Quadrants with 30-day contribution (`verity.recipe.get_menu_analytics`). | **Verity ahead** |
| **Multi-outlet** | Branch-scoped doctypes; reports filter by branch; no consolidated HQ layer. | Outlets inside one tenant; HQ across tenants; per-outlet availability, stock, cash and P&L. | **Verity ahead** |
| **Multi-tenant SaaS** | One Frappe site per business. | Row-level security, fail-closed tenancy, per-tenant packs and lifecycle (ADR-005, ADR-034). | **Verity ahead** |

### N

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Notifications** | KOT-delay notification to roles; in-app through Frappe. | Platform notification engine; outbox design accepted (ADR-039) but no dispatcher; provider binding shows "Not bound". | **Partial** |

### O

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Offline mode** | `README.md` lists "offline mode". A search of `pos/`, `self-order/` and `packages/` for service workers, IndexedDB and workbox found **no offline code**. The claim is not backed by this source tree. | `OfflineCommand` inbox and replay exist in the platform; no device screen uses them. | **Neither**; URY's README overstates |
| **Order pad** | Menu card grid, search, course sidebar, priority filter. Single click adds; double click opens the product page for customisation. Per-item comments, general order comment, favourites, pax count (`FEATURES.md`; `ProductDialog.tsx`, `OrderPanel.tsx`). | Category sections, search, note for the next item, portions, add-ons, quantity stepper, same item raises quantity, remove until sent then void with a reason, covers (`OrderPad.tsx`). | **Parity** |

### P

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Payment terminals** | An interface for card terminals with a *simulated* provider only. Real vendors (Ingenico, PAX, Verifone appear in a Select) are not implemented (`ury/ury/api/payment_terminal.py`). | Record-only by design: method plus reference (GOV-SCO-006). | **Neither**; URY has the seam, no vendor |
| **Payments** | ERPNext modes of payment; payment link and pay-at-counter from self-order. | cash, card, UPI, wallet, bank transfer, delivery platform, other; several payments per bill; overpayment refused. | **Parity** |
| **Printing** | Three paths: QZ Tray, ERPNext network printer, websocket print page. Printers per room (bill) and per production unit (KOT). Parcel-order and table-order printer settings (`ury_print.py`, `POS Profile-qz_print`). | Browser print of the bill only. | **Missing** for KOT and thermal bill printing |
| **POS profile switches** | One profile per counter: view all statuses, remove items after print, paid-invoice limit, discount on or off, edit order type, KOT reprint, multiple cashier, roles allowed to bill (`ury/hooks.py` fixtures). | The same questions are answered by roles and permissions (verb, entity, scope) and tenant configuration, not per-counter switches. | **Parity** in effect, different mechanism |
| **Procurement** | ERPNext Material Request, Purchase Order, Purchase Receipt. | Native: vendors, purchase orders with approval threshold, goods receipt, vendor payments, price history, vendor performance. Invoice photo on receipt deferred. | **Verity ahead**; **Not in URY** |
| **Production units (stations)** | A unit names a branch, warehouse, the **item groups it cooks**, printers, and which order types it displays. The KDS URL is per unit. A cron guards against missing KOTs (`doctype/ury_production_unit`). | No station concept. One kitchen queue per outlet. | **Missing** |

### R

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Refunds** | ERPNext POS return and credit note. | `refund_bill`: append-only, by amount or by items, reason mandatory, method never `delivery_platform`. | **Verity ahead** |
| **Reports** | 14 standard reports in the ERPNext desk plus a React report app: today's sales, day-wise sales, day-wise invoices, month-wise sales, average bill value, cancelled invoices, item-wise sales, customer data, repeated customers, day-wise customer details, employee sales, employee item-wise sales, service-wise (order type) sales, time-wise sales (hour buckets), item-wise purchase history, completed work orders, daily P&L (`ury/ury/report_api/*.py`, `frontend/src/pages/Reports/`). Branch hours can shift the business day. | `/reports` and its subpages are built for the trading tenant (board, supplier, ageing). **No page consumes `verity.dinein.sales_summary`.** Restaurant answers exist only as counter history, outlet P&L, guest 360, menu analytics, platform payouts and stock reports. | **Missing**. The largest single functional gap for an outlet owner |
| **Reservations** | Neither (tables carry only an occupied flag). | A manual `reserved` table state; no booking calendar (deferred, D9). | **Neither** |
| **Roles** | URY Manager, URY Captain, URY Cashier, plus Self Ordering Manager (`ury/fixtures/role.json`, `SETUP.md`). | Dynamic roles from verb, entity and scope, role composition, field-level permission (cost hidden from floor staff). | **Verity ahead** |

### S

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Scheduling and roster** | Not in URY. | `scheduling` resources and bookings; roster week grid; leave calendar. | **Verity ahead** |
| **Self-order** | Four modes (`URY Self Ordering Profile`): **QR table** (signed token per table), **QR pickup**, **kiosk** (landscape or portrait), **table tablet**. Devices enrol with a hashed credential; a staff PIN assigns a tablet to a table; guest sessions expire when idle. The guest browses, adds to a running table order, **requests the bill or a waiter** (`URY Service Request`), and can pay by link or at the counter (`ury/ury/api/self_ordering.py`, `self-order/src/layouts/`). | `qr` and `website` exist only as channel labels. No customer-facing surface. | **Missing**. Needs an ADR first (public, unauthenticated write path) |
| **Setup wizard and demo data** | Guided setup for branch, rooms, tables, menu, payment and users (`frontend/src/pages/Setup/`), plus a full demo restaurant (`ury/setup/demo_data/`). | HQ onboarding checklist computed from real state; signed packs; data import page. No "load a sample restaurant" button. | **Partial** |
| **Stock count and variance** | ERPNext Stock Reconciliation. | `apply_stock_count`, `food_cost_variance`, stock requests. | **Verity ahead** |
| **Suppliers** | ERPNext. | `create_vendor`, performance, price history. | **Verity ahead** |

### T

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Table operations** | **Table transfer**, captain transfer, table merge and unmerge as a visual cluster, merged label on the bill (`TableTransferDialog.tsx`, `TableMergeDialog.tsx`, `TableUnmergeDialog.tsx`, `POS Invoice-custom_merged_tables`). | `move_table`, `move_order_to_table`, `merge_orders`, cleaning state after settle. No unmerge; merging joins orders, not table positions. | **Parity**, minus unmerge |
| **Taxes** | ERPNext Sales Taxes and Charges Template: any country, any rate; default template per restaurant. | India GST. **One CGST and one SGST rate pair per tenant for the whole bill** (config keys `verity.dinein.tax.cgst_rate` and `sgst_rate`), stored in basis points per bill. GSTR-1, GSTR-3B and ITC screens exist on the trading side (`/tax/*`). No per-item rate, no IGST, no service charge. | **Partial**. Ahead on filing, behind on per-item rates |
| **Tips and service charge** | Not built in URY; ERPNext taxes and charges could model a service charge. | Not built. Overpayment is refused as a mistake ("No tips in v1", `dinein/index.ts:1751`). | **Neither** |

### U

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Units of measure** | ERPNext UOM with conversions. | Item unit label only; PRD §68 to §69 marked partial. | **Not verified in depth** |
| **Users and access** | Frappe users; the branch user table limits POS access. | Identity provider (ADR-020), membership, location assignment. A client admin creates sign-ins in People. | **Verity ahead** |

### V

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Variants and portions** | Variant and add-on child tables on Item. | Portions and add-ons per menu item, snapshotted on the line. | **Parity** |
| **Void and cancel** | Cancel the draft invoice; reason on the invoice (`POS Invoice-cancel_reason`); cancelled-invoices report; cancel-button permission (`button_permission.py`). | Void line with reason (the kitchen sees it), cancel order, void bill; refund after settle. | **Parity** |

### W

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Waiter call and bill request** | Service request from the guest's device (`URY Service Request`; status Open, Acknowledged, Resolved). | None. | **Missing**; comes with self-order |
| **Wastage** | ERPNext stock entry. | `record_wastage`, flagged for review above ₹2,000. | **Verity ahead** |

### Z

| Capability | URY | Verity | Verdict |
|---|---|---|---|
| **Zones and rooms** | Room with type and printers. | `DiningZone` per outlet with floor label and sort order. | **Parity**, minus printers |

---

## 3. Defects found in Verity while comparing

These came out of reading code for this document. I did not change code.

1. **`verity.dinein.sales_summary` ignores its `day` input.** `src/server/capabilities/dinein/index.ts:2395`
   tests the date with `/^d{4}-d{2}-d{2}$/`. The backslashes are missing, so the pattern matches only the
   literal text "dddd-dd-dd" and every call falls back to today. A report that asks for another day will
   silently show today's figures. Fix: `/^\d{4}-\d{2}-\d{2}$/`.
2. **The service day is hard-coded to end at 05:00 the next morning** (`dinein/index.ts:2399`,
   `+ interval '5 hours'`). URY lets each branch set its own cutoff (`URY Report Settings.hours`).
3. **No page reads the restaurant sales summary.** `src/app/(shell)/reports/page.tsx` was rewritten for the
   plywood tenant and mentions `salesSummary` only in a comment. This is a gap rather than a defect, but it
   is why Reports is the largest hole in section 2.
4. **The bill carries one tax rate pair.** A 5 percent food line beside an 18 percent line cannot be billed
   correctly on one bill. Acceptable for a food-only outlet; wrong the day one sells anything taxed
   differently.
5. **A dine-in bill has no consecutive invoice number, no seller identity, and a refund is not a credit
   note.** The trading side has all three (`trading_invoice_series`, seller GSTIN snapshot); the restaurant
   side does not. Colonel Kebabz has billed this way since 2026-09-10. Found after the first version of
   this document; the largest item in the plan. See ADR-040.
6. **Service days overlap.** `serviceDayRange` returns day D as 00:00 on D to 05:00 on D+1, so bills settled
   between 00:00 and 05:00 fall in two consecutive days' ranges (`dinein/index.ts:2397-2399`).

**What happens next:** the gaps in section 2 and these defects are mapped, dispositioned and sequenced in
`taskplans/126_ury_gap_closure_restaurant_operations.md`, with ADR-040 (GST bill), ADR-041 (kitchen
stations, courses, tickets, printing), ADR-042 (customer self-order) and ADR-043 (scoped menu prices),
all PROPOSED and awaiting approval.

URY's own overstatement: the README advertises offline mode that this source tree does not implement.

---

## 4. What the comparison says to build, in order

Basis: the standing rules in `CLAUDE.md` and project memory. Verity's market is 10 to 100 person businesses;
lean V1; do not copy a feature because URY has it. "Needs ADR" means a security boundary or a new platform
primitive, so the `CLAUDE.md` stop conditions apply.

**Tier 1: an outlet owner cannot run the outlet without these**

| # | Build | Why | Notes |
|---|---|---|---|
| 1 | **Restaurant sales reports**: today, day-wise, month-wise, hour-wise, item-wise, order-type-wise, employee-wise, cancelled, average bill. Fix defects 1 and 2 first. | URY's whole report pack. Verity has the data (`Bill`, `Payment`, `OrderLine`, channel) and no screen. | No migration. One query and one page per report; reuse `DataTable`. |
| 2 | **Outlet dashboard**: sales today, covers, average per cover, ticket time, tables occupied, bills unpaid over 15 minutes, tables seated over 60, day left open. | URY's `get_needs_attention` and shift metrics. All derivable from existing tables. | No migration. |
| 3 | **Per-item tax rate** (with IGST and service charge as later options). | Billing correctness. | Schema change to `Bill`; check against the GST filing screens. Owner decides how many rates the client needs. |

**Tier 2: kitchen and counter depth**

| # | Build | Why | Notes |
|---|---|---|---|
| 4 | **Kitchen stations**: a station names the categories it cooks; the kitchen board filters by station; a station can print. | URY production units. | New table `kitchen_station`. Printing is hardware, which GOV-SCO-006 excludes today; a one-line decision to allow *KOT print* (not cash drawers, not terminals) comes first. |
| 5 | **Courses and serve order** on menu items and the kitchen card. | URY menu course. | Small: a closed field on the item, shown on the card. |
| 6 | **Captain transfer** (hand an open order to another waiter). | URY; daily use in busy outlets. | One audited command. |
| 7 | **Opening and closing checklist** for the outlet. | URY; PRD §56 to §57. | Reuse the platform Checklist template; gate the day close. |
| 8 | **Table-age badge** and alerts for tables seated too long or orders unpaid too long. | URY. | Pure read. |

**Tier 3: decide before building**

| # | Item | Decision needed |
|---|---|---|
| 9 | **Cashier shift sessions** (opening float per cashier, per-mode count, close with difference). | Today the drawer is reconciled per outlet per day. Does Colonel Kebabz run more than one cashier on a shift? If not, skip. |
| 10 | **Per-room or per-channel price** (the Zomato menu priced above dine-in). | Availability by channel exists; price by channel does not. Is it a recurring request? |
| 11 | **Combos and bundles.** | Is it asked for? |
| 12 | **Item photos on the pad.** | Blocked until storage upload is proven in a client (decision 2026-10-09). |
| 13 | **Daily fixed-cost allocation** (electricity, rent per day, depreciation) in the P&L. | Matches URY's daily P&L; adds a settings screen and a daily rule. Is a monthly view enough? |

**Tier 4: needs an ADR before any code**

| # | Item | Why an ADR |
|---|---|---|
| 14 | **Customer self-order** (QR table, QR pickup, kiosk, table tablet, call waiter, request bill). | An unauthenticated public write path into a tenant. `CLAUDE.md` says tenant context comes from the authenticated context, never a payload. ADR-030 (public verification passport: a hashed token resolved by one definer function) is the closest precedent; design it on that pattern. |
| 15 | **Payment terminal integration.** | GOV-SCO-006 excludes it, and URY ships only a simulated provider. Not worth an ADR until a client names a terminal vendor. |

**Do not copy.** Per-counter POS Profile switches (roles and permissions already answer them). Print-before-submit
as a hard gate (it blocks recovery from a printer failure; a warning is enough). Sub-invoices per split (one
GST bill with several payments is the decision of record). Offline mode (URY does not have it either).

**Where Verity is ahead and a URY user would notice:** tenant isolation, field-level roles, approvals,
append-only audit, procurement with goods receipt and vendor performance, stock count and food-cost variance,
guest 360 with segments and merge, loyalty and coupons without stacking, attendance and roster, leave and
payroll inputs, platform payout matching, GST filing, HQ across clients, signed packs.

---

## 5. Sources

URY: `README.md`, `FEATURES.md`, `SETUP.md`, `ury/hooks.py`, `ury/ury/doctype/*/` (48 definitions),
`ury/ury/api/*.py`, `ury/ury_pos/api.py`, `ury/ury/hooks/*.py`, `ury/ury/report_api/*.py`, `pos/src/`,
`self-order/src/`, `mosaic/src/`, `frontend/src/pages/`.

Verity: `prisma/schema.prisma` (dine-in models, roughly lines 2280 to 2675),
`src/server/capabilities/{dinein,recipe,inventory,crm,loyalty,coupon,finance,hr,attendance,scheduling,
complaint,approval}/`, `src/app/(shell)/{floor,counter,kitchen,menu,recipes,reports,cash-reconciliation,
outlet-pnl,platform-payouts,guests,attendance,hr}/`, `taskplans/125_pending_work_register_2026_10_06.md`,
`clients/colonel-kebabz/reference-parity/`.

Not verified: URY at runtime (nothing was started); ERPNext behaviour beyond what URY's hooks and fixtures
name; Verity bill numbering and unit-of-measure depth; the `/reports/*` subpages beyond their headings.
