# Colonel Kebabz — menu, menu versioning, recipes and food cost

Depth document for PRD §12–§16. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

## What the client asked for (PRD §12–§16)

- **§12 Menu, controlled by HQ.** Per item: name, SKU, category, description, image, selling price, tax,
  recipe, food cost, gross margin, preparation time, availability, **outlet availability**, **channel
  availability**.
- **§13 Menu versioning.** Every change tracked (old → new price, changed by, effective date, reason);
  previous versions stay accessible.
- **§14 Recipe.** Each menu item has a recipe; system calculates ingredient quantity and cost, recipe
  cost, food cost %, theoretical consumption.
- **§15 Recipe BOM.** Sales automatically generate theoretical ingredient consumption.
- **§16 Food cost.** Theoretical vs actual: Opening + Purchases − Closing = actual consumption, compared
  with recipe × sales; variance in quantity and %, with a status (e.g. Critical).

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo (`odoo:point_of_sale/views/point_of_sale_view.xml`, `product_view.xml`, `pos_category_view.xml`,
`product_combo_views.xml`; `odoo:mrp/views/mrp_bom_views.xml`):

```
Point of Sale › Products        Products · Product Variants · Combo Choices · Pricelists
Point of Sale › Configuration   Products: PoS Categories · Attributes · Tags · Taxes
Manufacturing › Products        Bills of Materials
Manufacturing › Reporting       BoM Overview (structure and cost)
```

ERPNext: Stock workspace (Item, Item Group, Item Price, UOM Conversion), Manufacturing workspace (BOM,
BOM Update Tool, BOM Explorer, BOM Stock Analysis, BOM Variance report)
(`erpnext:stock/doctype/item`, `erpnext:stock/doctype/item_price`, `erpnext:manufacturing/doctype/bom`,
`erpnext:manufacturing/doctype/bom_update_tool`, `erpnext:manufacturing/report/`).

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions | Source |
|---|---|---|---|
| Odoo product form | general (price, cost, taxes, category, internal reference = SKU, image); Point of Sale tab: available in POS, POS categories, optional products, to weigh; variants tab: attributes and values | archive, duplicate; smart buttons for variants, BoM, sales | `odoo:point_of_sale/models/product_template.py` (`available_in_pos`, `pos_categ_ids`, `pos_optional_product_ids`), `odoo:product/views/product_template_views.xml` |
| Odoo POS category | name, parent, sequence, image, colour, **available after / until (hour)** | create, edit | `odoo:point_of_sale/models/pos_category.py` (`hour_after`, `hour_until`) |
| Odoo attributes | attribute values with price extra; "never create variant" attributes act as modifiers chosen at the till | create, edit | `odoo:product/models/product_attribute.py` |
| Odoo combo choices | combo groups, items, max quantity, free quantity | create, edit | `odoo:point_of_sale/models/product_combo.py` (`qty_max`, `qty_free`) |
| Odoo pricelists | rules by product/category, min qty, **date start/end** | create, edit | `odoo:product/models/product_pricelist_item.py` |
| Odoo BoM | product, quantity produced, unit, type (manufacture / **kit**), components with quantity and unit, by-products, operations | Catalog (add components), Compute | `odoo:mrp/models/mrp_bom.py` (`type` normal/phantom, `bom_line_ids`, `byproduct_ids`), `odoo:mrp/views/mrp_bom_views.xml` |
| Odoo BoM Overview | exploded structure, cost per component, total | print | `odoo:mrp/report/mrp_report_bom_structure.py` |
| ERPNext Item | tabs Inventory, Variants, Sales, Tax, Manufacturing, Purchasing, UOM, Pricing, Accounting | Duplicate | `erpnext:stock/doctype/item/item.json`, `item.js` |
| ERPNext BOM | quantity, items, **is_active / is_default** (several BOMs per item = versions), raw-material cost basis (`rm_cost_as_per`), **process loss %**, scrap items, exploded items, total cost | Alternate Item; new BOM copies old | `erpnext:manufacturing/doctype/bom/bom.json`, `bom.js` |
| ERPNext BOM Update Tool | replace a component across all BOMs, update costs in bulk | Replace, Update latest price | `erpnext:manufacturing/doctype/bom_update_tool/` |

### 4.3 Workflows

- **Menu change:** edit price on product or add a dated pricelist rule (Odoo); ERPNext Item Price rows
  with valid-from dates. Field history via Odoo chatter tracking. Neither has a named "menu version"
  object; history is per field or per dated price row.
- **Recipe change:** ERPNext creates a new BOM and makes it default; the old one stays (inactive or
  non-default) — this is BOM versioning. Odoo edits the BoM in place with chatter history; a kit BoM
  makes a sale consume components directly.
- **Theoretical consumption:** Odoo kit BoM on a POS product explodes to component stock moves at order
  validation. ERPNext POS consumes the item itself; component consumption needs manufacturing entries.

### 4.4 Reports

Odoo BoM Overview (cost per dish), POS sales by product (margin with cost), stock valuation.
ERPNext BOM Explorer, BOM Stock Analysis, **BOM Variance Report** (planned vs actual consumption on
work orders) (`erpnext:manufacturing/report/bom_variance_report`). Neither ships a restaurant
theoretical-vs-actual food cost report; it is assembled from stock movement and consumption reports.

### 4.5 Configuration

Units of measure and conversions (`odoo:uom`, `erpnext:stock/report/uom_conversion_detail`), taxes per
product, POS categories, attributes, combos, pricelists, cost method (standard / average).

### 4.6 Automation

Kit explosion on sale (Odoo), cost roll-up (Odoo BoM cost, ERPNext BOM Update Tool "update latest
price"), price validity by date.

### 4.7 Roles

Odoo: Inventory/Manufacturing managers edit products and BoMs; POS users only sell. ERPNext: Item
Manager, Manufacturing Manager.

## 5. Verity today

Evidence: `verity:src/server/capabilities/dinein/index.ts` (menu), `verity:src/server/capabilities/recipe/index.ts`
(recipe; its header lists what is not built), pages `/menu` (`MenuAdmin.tsx`), `/recipes`,
`/recipes/[menuItemId]` (`RecipeForm.tsx`).

| Reference item | Verity equivalent | Status |
|---|---|---|
| Menu categories | `create_menu_category`; on `/menu` | Built |
| Create item: name, category, price, description, cost | `create_menu_item`; on `/menu` | Built |
| Edit item (price, name, description) | `edit_menu_item`; Edit on `/menu` (name, price) since 2026-10-05 | Built (description not on screen) |
| Activate / deactivate item | `set_menu_item_active`; on `/menu` | Built |
| Variants / modifiers with price delta | `create_menu_variant`; Add portion on `/menu` since 2026-10-05 | Built |
| SKU, image, tax per item, preparation time | not on menu item | Missing |
| Outlet availability (item on/off per outlet) | menu is tenant-wide | Missing |
| Channel availability / channel prices | no channel concept (see POS document) | Missing |
| Time-of-day availability (breakfast menu) | none | Missing |
| Combos / meal deals | none | Missing |
| Price change history (who, when, reason, effective date) | audit trail records `edit_menu_item` changes; no history view, no effective date, no reason | Partial |
| Recipe per menu item: ingredients, quantity, unit, yield | `save_recipe` (whole recipe replaced, `version` increments), on `/recipes/[menuItemId]` | Built |
| Recipe cost and food cost % | `get_recipe_cost` (uses inventory average unit cost) | Built |
| Recipe history / previous versions viewable | version counter only; prior lines overwritten | Missing |
| Per-variant recipe (half / full portion) | none (header says not built) | Missing |
| Process loss / wastage % in recipe | none | Missing |
| Theoretical consumption posted on sale | `postConsumptionForOrder`, called by `settle_bill` | Built |
| Theoretical vs actual food cost variance report (§16) | none (header says not built) | Missing |
| Menu engineering (Star / Plow Horse / Puzzle / Dog) | `get_menu_analytics`, `/recipes` | Built (beyond both reference systems) |
| Bulk replace an ingredient across recipes, bulk cost update | none; cost updates automatically from average cost | Partial |
| Units and conversions (kg ↔ g, l ↔ ml) | `unitLabel` free text on ingredient | Partial — no conversion |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Edit item button on `/menu` (inline or form) | **Include** | backend exists; HQ cannot fix a price today |
| Variants / modifiers on `/menu` and at the order screen | **Include** | backend exists; POS document needs modifiers |
| SKU, image, tax rate, preparation time on menu item | **Include** | PRD §12 fields; prep time feeds kitchen delay highlighting |
| Outlet availability per item | **Include** | PRD §12 example lists outlets explicitly; multi-outlet brand |
| Channel availability and channel price (aggregator prices) | **Include** | PRD §12; depends on the channel field from the POS document |
| Price history with effective date and reason | **Include** | PRD §13 example is exactly this; today's audit trail lacks reason and effective date |
| Recipe history (keep prior versions readable) | **Include** | PRD §13 "previous versions must remain accessible"; ERPNext BOM default/active is the model |
| Theoretical vs actual food cost variance report with status | **Include** | PRD §16 is a named requirement and the main reason for recipes; needs stock counts (inventory document) |
| Unit conversion for ingredients | **Include** | recipe in grams vs stock in kg is daily reality; covered with the inventory document |
| Process loss % per recipe | **Include** | needed for an honest variance (trim, cooking loss) |
| Per-variant recipe (half / full) | **Include** | kebab portions are sold in sizes |
| Combos / meal deals | Defer | not in PRD §12; revisit with loyalty/offers |
| Time-of-day availability | Defer | not in PRD |
| Bulk ingredient replace across recipes | Defer | useful at scale; not needed for 3 outlets |
| Kit vs manufacture distinction, by-products, operations | Not applicable | restaurant recipes are kits by nature; Verity already consumes on sale |

## 7. Verity design for this client

Within `dinein` (menu) and `recipe`; no new platform primitive.

1. **Menu item form** (create and edit share one form): name, category, SKU, image (platform storage,
   once bound — HQ audit L2), price, tax rate, preparation minutes, description, active. Edit records a
   reason and an effective date; a future effective date schedules the price.
2. **Variants and modifiers** section on the item: name and price delta, required/optional group.
3. **Availability** section: outlets where sold (default all), channels where sold, and channel price
   override.
4. **History tab** on the item: price changes (old → new, who, when effective, reason) and recipe
   versions (read-only snapshot of each saved recipe).
5. **Recipe** per item and per variant; add process loss %; ingredient unit chosen from the inventory
   item's units with conversion.
6. **Food cost page** (`/recipes` gains a "Food cost variance" tab): per ingredient, per outlet, per
   period — opening, purchases, closing, actual, theoretical, variance qty, variance %, status bands
   (configurable thresholds, default 5% warning, 10% critical). Requires stock counts from the inventory
   document.

Open decision: whether a price change at HQ needs approval before it takes effect at outlets.

## 8. Acceptance

Module completeness bar rows (`docs/reference/module-completeness-bar.md`): nav resolves, every command
reachable or marked internal, no internal identifiers, empty/error states, per-row actions, export.

Live walk-through on the Colonel Kebabz tenant:
1. Edit Chicken Seekh Kebab price ₹480 → ₹520, reason "ingredient cost", effective tomorrow; history
   shows the pending change; next day the order screen uses ₹520.
2. Add Half / Full variants with their own recipes; food cost % shows for each.
3. Disable the item at R.K. Puram only; it disappears from that outlet's order screen.
4. Set a Zomato price; a Zomato order uses it.
5. Change the recipe; the previous version is still readable in history.
6. After a day of sales and a closing stock count, the food cost variance page shows chicken
   theoretical vs actual with variance % and status.
