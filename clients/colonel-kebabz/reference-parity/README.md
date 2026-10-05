# Colonel Kebabz — reference-parity document

Template: `docs/reference/client-reference-parity-template.md`. Started 2026-10-05.
Status: **module map done; depth documents: 1 of 7 written** (POS, channels, tables, kitchen; see §3).

## 1. Client and requirement sources

- **Client:** Colonel Kebabz, multi-outlet restaurant brand (Defence Colony, Gurugram, R.K. Puram /
  Som Vihar outlets; HQ plus franchise ambitions). Live tenant on `app.theverityai.xyz` since
  2026-09-10, 11 of 22 modules enabled, 3 people (owner still "Invited" as of 2026-10-05).
- **Requirement source:** `clients/colonel-kebabz/prd.md` (3,708 lines, sections §1–§90+, "Multi-Outlet
  Restaurant ERP, CRM & Franchise Operations Platform"); delivery plan `clients/colonel-kebabz/phase-plan.md`.
- **Complaint that triggered this document (2026-10-05):** the instance is not comparable to Odoo or
  other ERPs; modules and workflows incomplete; not usable.

## 2. Reference systems — what applies

- **Odoo 19 Community** (`D:\Code\R&D\odoo-19.0\addons\`) has a complete restaurant stack:
  `point_of_sale`, `pos_restaurant` (floors, tables, kitchen printing, bill splitting), `pos_self_order`,
  `pos_loyalty`, `loyalty`, `pos_hr`, `pos_online_payment`, plus `stock`, `purchase`, `mrp` (BOM for
  recipes), `hr`, `hr_attendance`, `hr_holidays`, `hr_expense`, `account`, `crm`, `mass_mailing`,
  `survey`, `project`, `maintenance`, `spreadsheet_dashboard`.
  **Not in Community** (Enterprise-only, so not available to read): approvals, helpdesk, planning
  (shift rostering), documents, quality, payroll, appraisal. Parity for those is designed from the PRD
  and ERPNext, not from Odoo source.
- **ERPNext** (`D:\Code\R&D\erpnext\erpnext\`) has **no restaurant module** (none in `modules.txt` or
  `hooks.py`). It applies to the back office: `stock` (Item, Warehouse, Material Request, Stock Entry,
  Stock Reconciliation, Purchase Receipt, Batch), `buying`, `accounts` (POS Invoice, POS Profile, POS
  Closing Entry, Loyalty Program, Coupon Code, Pricing Rule, Journal Entry, Payment Entry),
  `manufacturing` (BOM), `crm`, `quality_management`, `assets`, `projects`, `support`.

## 3. Module map and scorecard

Status of Verity today is from the 2026-10-04 wiring audit and the route tree, not yet from a live
walk-through of this tenant. Depth document column links the per-module file once written.

| PRD § | Client need | Odoo | ERPNext | Verity today | Depth doc |
|---|---|---|---|---|---|
| 5, 6, 86–90 | HQ and outlet dashboards, daily summary, owner dashboard, health score, red flags | `point_of_sale` dashboards, `spreadsheet_dashboard` | Workspace, `report_center` | `/overview` platform dashboard; restaurant-specific KPIs partial | — |
| 7 | Outlet management | `pos.config` per shop, `stock.warehouse` | POS Profile, Warehouse | `location` capability, `/locations` | — |
| 8–9 | POS and order channels (dine-in, takeaway, delivery, aggregators) | `point_of_sale`, `pos_restaurant`, `pos_self_order`, `pos_online_payment` | POS Invoice, POS Profile | `dinein` `/counter`, `/floor`; 14 of 30 dine-in actions not reachable from a screen | [pos-restaurant.md](pos-restaurant.md) |
| 10 | Table management | `pos_restaurant` floors and tables | — | `/floor`, `/floor/setup` | [pos-restaurant.md](pos-restaurant.md) |
| 11 | Kitchen display | `pos_restaurant` kitchen printers / order preparation display | — | `/kitchen` | [pos-restaurant.md](pos-restaurant.md) |
| 12–13 | Menu and menu versioning | `product` + `pos` categories, combos, attributes | Item, Item Variant | `/menu`; edit item and variants not reachable | — |
| 14–16 | Recipe, recipe BOM, food cost | `mrp` BOM, product cost | BOM | `recipe` `/recipes` (menu engineering analytics) | — |
| 17–20, 27 | Inventory, stock ledger, stock count, wastage, transfers | `stock` (locations, moves, inventory adjustments, scrap, internal transfers) | Stock Entry, Stock Reconciliation, Stock Ledger report | `inventory` capability: **nav link `/inventory` has no page (404)**; 0 of 8 actions on a screen | — |
| 21–26 | Procurement: purchase requests, POs, GRN, vendors, price history | `purchase`, `stock` receipts, vendor pricelists | Material Request, Purchase Order, Purchase Receipt, Supplier | Not built for this client (trading capability exists for Shree Ganesh) | — |
| 28–30 | Customer CRM, 360, segmentation | `crm`, `contacts`, POS customer | Customer, CRM | `crm` `/guests` | — |
| 31–32 | Loyalty, offers, coupons | `loyalty`, `pos_loyalty` | Loyalty Program, Coupon Code, Pricing Rule | `loyalty`, `coupon` `/coupons` | — |
| 33–35 | Campaigns, marketing calendar, reviews | `mass_mailing`, `marketing_card`, `survey` | — | Not built | — |
| 36–37 | Complaints, service recovery | Helpdesk (Enterprise) | Issue (`support`) | `complaint` `/complaints` | — |
| 38–43 | Staff, attendance, shifts, leave, payroll inputs, performance | `hr`, `hr_attendance`, `hr_holidays`, `pos_hr`; planning/payroll Enterprise | Employee, Attendance, Shift, Leave | `attendance` `/attendance`; `hr` `/hr` built 2026-10-04 (unverified) | — |
| 44–49 | Expenses, cash, payments, aggregator reconciliation, finance dashboard, outlet P&L | `hr_expense`, `account`, `point_of_sale` session closing | POS Closing Entry, Journal / Payment Entry | `finance` `/expenses`, `/cash-reconciliation`, `/outlet-pnl` | — |
| 50–52 | Franchise, royalty, compliance | — (custom in both) | — | Not built | — |
| 53, 56–57 | Outlet audits, opening and closing checklists | `survey`; quality Enterprise | Quality Inspection | Not built | — |
| 54–55 | Tasks, SOPs | `project`, knowledge (Enterprise) | Task, Project | Not built for this client | — |
| 58–59 | Alerts and notification channels | `mail` activities, SMS | Notification | Platform notification engine; provider binding shows "Not bound" for this tenant (HQ audit L2) | — |
| 60–67 | Analytics, menu/customer/cohort analytics, benchmarking, forecasting | POS and stock reports, pivots | Reports | `/reports`, `/recipes` analytics; forecasting not built | — |
| 68–69 | Master data, units and conversions | `uom` | UOM, UOM Conversion | Partial | — |
| 70–71 | Documents, licences and compliance tracking | documents (Enterprise) | — | Not built | — |
| 72–76 | Audit log, approvals, search, import/export, API | `mail` tracking, approvals (Enterprise), base import | Version, Workflow, Data Import | Platform audit, `approval` `/approvals`, `/import`, external tool API (dark) | — |

**Headline:** of roughly 24 module groups in the PRD, Verity has a screen for about 13, of which
several are partial; about 8 groups are not built at all, and one registered page (`/inventory`)
does not exist.

## 4. Order for depth documents

Proposed, by daily use at an outlet: (1) POS, order channels, tables and kitchen; (2) menu and recipes;
(3) inventory, wastage and transfers; (4) procurement; (5) staff, attendance and leave; (6) cash,
expenses and outlet P&L; (7) CRM, loyalty and coupons; then the rest. Each depth file follows
template sections 4–8 and is linked in §3 when written.
