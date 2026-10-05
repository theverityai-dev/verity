# Colonel Kebabz — POS, order channels, tables and kitchen

Depth document for PRD §8–§11. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots used below: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` =
`D:\Code\R&D\erpnext\erpnext\`, `verity:` = this repository.

## What the client asked for (PRD §8–§11)

- **§8 Order record:** order ID, outlet, date/time, **channel**, customer, table, items, **modifiers**,
  quantity, discounts, taxes, payment method, status, staff member, **delivery partner**, **notes**.
- **§9 Channels:** dine-in, takeaway, phone, website, QR, delivery platforms (Zomato/Swiggy), walk-in,
  corporate, catering. "Order source must be stored."
- **§10 Tables:** floor plan, table numbers, capacity, states available / occupied / reserved /
  cleaning / billing, **merged tables**; track occupancy, **turnaround time**, covers, **revenue per table**.
- **§11 Kitchen display:** NEW → ACCEPTED → PREPARING → READY → PICKED UP / SERVED; show order number,
  order type, items, quantity, modifiers, special instructions, order age, priority; **highlight delayed orders**.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo back office, menu **Point of Sale** (`odoo:point_of_sale/views/point_of_sale_view.xml`,
`pos_order_view.xml`, `pos_session_view.xml`, `point_of_sale_dashboard.xml`, `point_of_sale_report.xml`,
`odoo:pos_restaurant/views/pos_restaurant_views.xml`):

```
Point of Sale
├─ Dashboard                     one card per shop/register: open session, continue selling, close
├─ Orders
│  ├─ Orders                     every order, all shops
│  ├─ Sessions                   one row per register shift
│  ├─ Payments
│  ├─ Customers
│  └─ Preparation printers
├─ Products
│  └─ Products · Product Variants · Combo Choices · Pricelists
├─ Reporting
│  └─ Orders (pivot/graph) · Sales Details · Session Report
└─ Configuration
   ├─ Settings · Point of Sales (shops) · Payment Methods · Coins/Bills
   ├─ Presets (order types: dine-in / takeaway / delivery)
   ├─ Floor Plans (restaurant)   · Notes (kitchen note templates)
   └─ Products: Categories · Attributes · Tags · Taxes
```

The selling screen is a separate full-screen app (`odoo:point_of_sale/static/src/app/screens/`,
`odoo:pos_restaurant/static/src/app/screens/`): Floor, Product (order), Payment, Receipt, Ticket
(order history), Split Bill, Tip, Partner list, Login (cashier PIN, with `pos_hr`).

ERPNext has no restaurant module. Its POS is a single page app (`erpnext:selling/page/point_of_sale/`)
backed by POS Profile, POS Opening Entry, POS Invoice and POS Closing Entry
(`erpnext:accounts/doctype/pos_*`). No floor plan, tables, courses or kitchen display.

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions (state change) | Source |
|---|---|---|---|
| Dashboard | per shop: session state, last closing balance, unpaid orders | Open Register (session `opening_control`), Continue Selling, Close | `odoo:point_of_sale/views/point_of_sale_dashboard.xml` |
| Floor screen | floors as tabs; tables drawn at position with number, seats, shape, colour; occupied tables show guest count and order amount | tap table = open its order; New Order (floating, no table); edit mode: Add Floor, Add Table, Clone, Rename, Seats, Round/Square shape, Change Background, Delete, Save | `odoo:pos_restaurant/static/src/app/screens/floor_screen/*.xml`, `models/pos_restaurant.py` (`restaurant.floor`, `restaurant.table` incl. `parent_id` for merged tables) |
| Order (product) screen | category bar, product grid, order lines with qty/price/discount, customer, preset (order type) | Preset (dine-in/takeaway/delivery), Pricelist, Tax (fiscal position), Guests, Course (add course), Fire course, Send (to kitchen), Plan (back to floor), Assign (to table), New, Split, Print bill, Refund, Save, Cancel order, Pay | `odoo:point_of_sale/static/src/app/screens/product_screen/control_buttons/control_buttons.xml`, `odoo:pos_restaurant/.../control_buttons/control_buttons.xml`, `.../actionpad_widget/actionpad_widget.xml` |
| Payment screen | payment lines per method, remaining/change, customer | Customer, Invoice, Tip, Ship Later, Validate (order `draft` → `paid`), Back | `odoo:point_of_sale/static/src/app/screens/payment_screen/` |
| Split bill | lines with qty to move | move lines/quantities to a new order, pay separately | `odoo:pos_restaurant/static/src/app/screens/split_bill_screen/` |
| Receipt | printed/emailed receipt | Print, Email, New Order | `odoo:point_of_sale/static/src/app/screens/receipt_screen/` |
| Ticket (order history) | all orders of the session, filter by state, search | Load Order, Review, Refund | `odoo:point_of_sale/static/src/app/screens/ticket_screen/` |
| Orders (back office) | list/form: lines, payments, customer, session, table, guests, courses | Payment, Invoice (`action_pos_order_invoice`), Return Products (`refund`) | `odoo:point_of_sale/views/pos_order_view.xml`, `odoo:pos_restaurant/models/pos_order.py` |
| Session | opening cash, orders, payments by method, expected vs counted cash, notes | Continue Selling, Close Session & Post Entries (`action_pos_session_closing_control`) | `odoo:point_of_sale/views/pos_session_view.xml`, `models/pos_session.py` |
| Preset (order type) | label, pricelist, fiscal position, identification required (none/name/address), return mode, timed slots (capacity per interval) | create/edit | `odoo:point_of_sale/models/pos_preset.py`, `views/pos_preset_view.xml` |
| ERPNext POS Invoice | items, payments, loyalty, customer | Return | `erpnext:accounts/doctype/pos_invoice/pos_invoice.js` |
| ERPNext POS Closing Entry | per-method expected/closing amounts, taxes, invoices merged | Retry (failed merge) | `erpnext:accounts/doctype/pos_closing_entry/pos_closing_entry.js` |

### 4.3 Workflows

- **Register session** (`odoo:point_of_sale/models/pos_session.py` `POS_SESSION_STATE`): Opening Control
  → In Progress → Closing Control → Closed & Posted. Opening and closing count cash; the difference is
  posted. ERPNext equivalent: POS Opening Entry → POS Invoices → POS Closing Entry.
- **Order** (`odoo:point_of_sale/models/pos_order.py`): New (`draft`) → Paid → Posted (`done`); or
  Cancelled. Refund creates a negative order linked to the original. Restaurant adds table, guest count
  and courses (`odoo:pos_restaurant/models/pos_order.py`, `restaurant_order_course.py`: course `fired`,
  `fired_date`).
- **Dine-in happy path:** floor → tap table → set guests → add items (by course) → Send to kitchen →
  fire next course → Print bill → (Split) → Pay → table frees.
- **Exceptions:** move order to another table (Assign), merge tables (`restaurant.table.parent_id`),
  split bill, cancel order, refund after payment, tip after payment (`pos_config.set_tip_after_payment`).
- **Takeaway / delivery:** chosen per order by Preset; preset may require name or address and can run
  timed pickup slots.

### 4.4 Reports

Orders analysis (pivot/graph by shop, product, category, cashier, hour), Sales Details (per session or
date range: products, payments by method, taxes, discounts), Session Report
(`odoo:point_of_sale/views/point_of_sale_report.xml`, `pos_order_report_view.xml`,
`report_saledetails.xml`).

### 4.5 Configuration

Per shop (`pos.config`): payment methods, cash control and coins/bills, receipt header/footer,
default screen (Tables or Register), floors, bill splitting, bill printing, tips, preparation printers
per category, presets, pricelists (`odoo:pos_restaurant/models/pos_config.py`,
`odoo:point_of_sale/views/pos_config_view.xml`, `res_config_settings_views.xml`).

### 4.6 Automation

Orders sent to preparation printers/display by product category; course firing; session closing posts
accounting entries; stock moves are generated from paid orders (`pos.order.picking_ids`).

### 4.7 Roles

Odoo: POS User (sell, own sessions) and POS Administrator (configure, all sessions); with `pos_hr`,
cashiers log in by employee PIN and manager-only actions (refund, discount, price change) can be
restricted (`odoo:point_of_sale/security/`, `odoo:pos_hr`).

## 5. Verity today

Evidence: `verity:src/server/capabilities/dinein/index.ts`, pages under `verity:src/app/(shell)/`.

| Reference item | Verity equivalent | Status |
|---|---|---|
| Floor plan with tables, seats, position | `/floor` (`FloorPlan.tsx`), `/floor/setup` (`FloorEditor.tsx`); `define_zone`, `define_table`, `position_table` | Built |
| Table states | available / occupied / reserved / cleaning / out_of_service / retired (`move_table`) | Built (no "billing" state; bill exists as its own record) |
| Merge tables | none | Missing |
| Move order to another table | none (`move_table` changes table state, not the order's table) | Missing |
| Seat guests (covers), open order | `create_order` (covers required, table must be occupied) | Built |
| Add items, send to kitchen | `add_order_lines`, `place_order` | Built |
| Line notes / modifiers | `lineNote` on `add_order_lines`; note field on the order pad (2026-10-05). Modifiers as portions (variants) only | Built (notes); Partial (modifiers) |
| Courses / fire course | none | Missing |
| Kitchen display | `/kitchen` (`KitchenBoard.tsx`), line states preparing → ready → served; `sweep_prep_breaches` flags late lines | Built; no "accepted" step, no order type shown (all orders are dine-in) |
| Void a line (manager rule for cooked dishes) | `void_order_line` + guard; Void with reason on the order pad (2026-10-05) | Built |
| Cancel order | `cancel_order` | Built |
| Generate bill, discount with reason, print | `generate_bill`, `apply_bill_discount` (reason required), `/counter/[billId]` `BillView.tsx` prints | Built |
| Split bill | none | Missing |
| Payment methods, partial payments | `record_payment` cash / card / UPI, several per bill; `settle_bill` | Built (fixed list; no tips by design, comment in `record_payment`) |
| Refund / return after settlement | none | Missing |
| Order types: takeaway, phone, delivery, QR, aggregator platform | orders require an occupied table | **Missing — PRD §9 core requirement** |
| Register session open/close with cash count | `/cash-reconciliation` (finance capability), not tied to orders | Partial |
| Order history screen (search past orders, reprint) | `get_order_detail`, `list_open_bills` queries; no history page | Partial |
| Edit menu item, variants | `edit_menu_item`, `create_menu_variant`; Edit and Add portion on `/menu` (2026-10-05) | Built |
| Sales reports | `sales_summary` query (by payment method); `/reports` | Partial — no product / hour / staff breakdown |
| Turnaround time, revenue per table | not computed | Missing |
| Cashier login / manager-only actions | role grants via `enforcePolicy()`; cooked-line void needs manager | Built at permission level; no PIN switch |

## 6. Gap decisions

Decision owner for all rows: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Order channel on every order (dine-in, takeaway, phone, delivery, QR, walk-in, corporate, catering) + platform (Zomato/Swiggy) | **Include** | PRD §9 "order source must be stored"; outlet P&L and aggregator reconciliation (§47) depend on it |
| Takeaway/delivery orders without a table | **Include** | follows from the above; today every order needs a seated table |
| Line notes ("no onion") and modifiers | **Include** | PRD §8 and §11 list both; the kitchen cannot cook correctly without them |
| Void-line button (reason, manager rule kept) | **Include** | backend exists; only the screen is missing |
| Move order to another table | **Include** | daily floor operation |
| Merge tables | **Include** | PRD §10 names it |
| Split bill (by line and by equal parts) | **Include** | standard at every dine-in outlet |
| Refund / return of a settled bill | **Include** | needed for complaints (§36–37) and cash accuracy |
| Order history page (search, reprint, open detail) | **Include** | Odoo Ticket screen equivalent; needed for disputes |
| Kitchen: show channel, notes, order age; "accepted" step | **Include** | PRD §11 list |
| Turnaround time and revenue per table | **Include** | PRD §10 "track"; derivable from existing timestamps |
| Sales by product / hour / staff / channel | **Include** | needed by §5 dashboards; extend `sales_summary` |
| Register session tied to orders (expected cash from orders vs counted) | **Include** | closes the gap between `/counter` and `/cash-reconciliation` |
| Courses and course firing | Defer | kebab/QSR service rarely courses; revisit if a fine-dine outlet asks |
| Tips | Defer | v1 decision recorded in code; confirm with the client |
| Pricelists per channel (aggregator prices differ) | Defer | depends on the channel field; decide in the menu depth document |
| Timed pickup slots (Odoo preset slots) | Defer | no PRD requirement |
| Cashier PIN switch on a shared terminal | Defer | identity design; ADR-020 governs sign-in, not designed here |
| Native aggregator integration (Zomato/Swiggy APIs) | Defer | needs an integration decision and partner access; manual channel entry first |
| Fiscal position switch per order | Not applicable | single-country GST, already computed |
| Customer display, scale screen | Not applicable | no PRD requirement |

## 7. Verity design for this client

All within the existing `dinein` capability; no new platform primitive.

1. **Order channel.** Add `channel` (closed list from §9) and optional `platform` and `platformOrderRef`
   to the order; `create_order` takes them. `tableId` and `covers` become required only for
   `dine_in`. Counter gets a "New takeaway / delivery order" action next to the floor.
2. **Line notes and modifiers.** `add_order_lines` accepts a free-text note per line and selected
   modifiers (menu variants, which `create_menu_variant` already models); kitchen and bill show them.
3. **Floor actions on an open order:** Move to table, Merge with table (orders combine onto one bill),
   Void line (reason; cooked-line manager guard unchanged).
4. **Bill actions:** Split (by line, or N equal parts into separate bills), Refund a settled bill
   (full or by line, reason required, negative payment plus audit entry).
5. **Order history page** under `/counter`: search by number, table, channel, date; open detail; reprint.
6. **Kitchen board:** card shows channel, table or customer name, notes, age with the delayed highlight
   `sweep_prep_breaches` already computes, and an Accept step before Preparing.
7. **Reports:** extend `sales_summary` with by-product, by-hour, by-staff, by-channel, table turnaround
   and revenue per table.
8. **Session:** opening float and closing count on `/counter`; expected cash computed from settled cash
   payments; feeds `/cash-reconciliation`.

Open decision before building: whether a refund needs an approval (Verity `approval` capability) or a
manager permission alone.

## 8. Acceptance

Must pass the module completeness bar (`docs/reference/module-completeness-bar.md`): every nav link
resolves, every registered command reachable from a screen or explicitly marked internal, no internal
identifiers on screen, empty and error states, per-row actions, print.

Live walk-through on the Colonel Kebabz tenant with real menu data:
1. Seat table 4 with 3 covers, order 2 dishes with a note, send; kitchen shows note, channel, age.
2. Void one line before cooking; mark the other ready, then served.
3. Move the order to table 6; merge table 7 into it.
4. Generate the bill, split it in two, settle one by UPI and one by cash; reprint from order history.
5. Create a takeaway order and a Zomato delivery order with platform reference; both reach the kitchen.
6. Refund one line of a settled bill with a reason; audit trail shows actor and reason.
7. Close the session; expected cash equals cash payments; reports show the day by channel, product,
   hour and table turnaround.
