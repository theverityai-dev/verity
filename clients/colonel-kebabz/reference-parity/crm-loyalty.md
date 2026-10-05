# Colonel Kebabz — guests (CRM), customer 360, segments, loyalty, offers and coupons

Depth document for PRD §28–§32. Template sections 4–8 of
`docs/reference/client-reference-parity-template.md`. Written 2026-10-05 from source, not memory.

Source roots: `odoo:` = `D:\Code\R&D\odoo-19.0\addons\`, `erpnext:` = `D:\Code\R&D\erpnext\erpnext\`,
`verity:` = this repository.

## What the client asked for

- **§28 Unified customer profile:** name, phone, email, birthday, anniversary, preferred outlet and
  channel, order history, total spend, AOV, visit frequency, last order, favourite items, discounts used,
  loyalty points, complaints, reviews, marketing consent.
- **§29 Customer 360:** orders, visits, spend, favourite items and outlet, offers, loyalty, reviews,
  complaints, communication history.
- **§30 Dynamic segments** that update automatically: VIP (spend > ₹25,000), Frequent (5+ orders/month),
  At risk (45 days), Lapsed (90 days), New (first order within 30 days), High AOV (> ₹1,500), by outlet.
- **§31 Loyalty:** points, tiers, rewards, coupons, birthday and anniversary benefits, visit rewards;
  HQ-configurable rules (e.g. ₹100 = 5 points; 500 points = ₹100).
- **§32 Offers and coupons:** percentage, flat, buy X get Y, item, category, first-order, returning
  customer, outlet-specific, time-specific; conditions: minimum order value, segment, outlet, channel.

## 4. How the reference systems serve it

### 4.1 Navigation

Odoo: customers are `res.partner` contacts (Point of Sale › Orders › Customers, with a POS orders smart
button); promotions and loyalty live in **Point of Sale › Products › Discount & Loyalty** and the
`loyalty` app (`odoo:loyalty/views/*.xml`, `odoo:pos_loyalty`). The `crm` app is a sales pipeline (leads
and opportunities) and does not apply to walk-in diners.

ERPNext Selling/CRM: Customer, Customer Group, Loyalty Program, Loyalty Point Entry, Coupon Code, Pricing
Rule, Promotional Scheme (`erpnext:accounts/doctype/loyalty_program`, `coupon_code`, `pricing_rule`);
reports Customer Acquisition and Loyalty, Inactive Customers, Customers Without Any Sales Transactions,
Item-wise Sales History (`erpnext:selling/report/`).

### 4.2 Pages

| Page | Sections / key fields | Buttons and actions | Source |
|---|---|---|---|
| Odoo contact | name, phone, email, address, tags, notes; smart buttons POS orders, loyalty cards, sales | archive, merge contacts | `odoo:point_of_sale/views/res_partner_view.xml` |
| Odoo loyalty program | **program type**: Coupons, Gift Card, Loyalty Cards, Promotions, eWallet, Discount Code, Buy X Get Y, Next Order Coupons; validity dates, usage limit, applies on (current / future order), trigger (automatic / with code), point unit name, POS shops where valid | Generate coupons, share, archive | `odoo:loyalty/models/loyalty_program.py` (`program_type`, `date_from`, `date_to`, `limit_usage`, `max_usage`, `applies_on`, `trigger`) |
| Odoo program rules | minimum quantity, minimum purchase, products/categories, points per order / per money / per unit | add rule | `odoo:loyalty/models/loyalty_rule.py` (`minimum_qty`, `minimum_amount`, `mode`) |
| Odoo program rewards | reward type (discount / free product), discount mode (percent / fixed / per point), applicability (order / cheapest / specific products), points required | add reward | `odoo:loyalty/models/loyalty_reward.py` (`reward_type`, `discount_mode`, `discount_applicability`) |
| Odoo loyalty card | customer, points balance, history, expiry | — | `odoo:loyalty/models/loyalty_card.py` |
| Odoo loyalty mail | send on create / on points reached | template | `odoo:loyalty/models/loyalty_mail.py` (`trigger`) |
| ERPNext Loyalty Program | single or **multiple tier**; tiers (name, min spent, collection factor); conversion factor; expiry duration; customer group; auto opt-in | — | `erpnext:accounts/doctype/loyalty_program/loyalty_program.json`, `loyalty_program_collection.json` |
| ERPNext Pricing Rule | apply on item / item group / brand / transaction; price or product (free item) discount; rate / % / amount; min qty, min amount; valid from–upto; applicable for customer / customer group / territory / campaign; warehouse (outlet); coupon based | — | `erpnext:accounts/doctype/pricing_rule/pricing_rule.json` |
| ERPNext Coupon Code | promotional or gift card; pricing rule; validity; maximum use; used count; customer | — | `erpnext:accounts/doctype/coupon_code/coupon_code.json` |

### 4.3 Workflows

- **Earn:** order paid → rule matches → points added to the customer's card (Odoo) / Loyalty Point Entry
  (ERPNext) at the tier's collection factor.
- **Redeem:** at the till, eligible rewards are offered; choosing one adds a discount or free item line
  and debits points. Points expire after the configured duration (ERPNext).
- **Promotion:** automatic when conditions match (Odoo trigger automatic; ERPNext pricing rule); or with a
  code (coupon / discount code), respecting validity and usage limits.

### 4.4 Reports

Customer acquisition and loyalty, inactive customers, item-wise sales history per customer, loyalty
points balance, promotion usage.

### 4.5 Configuration

Programs, rules, rewards, tiers, conversion rate, expiry, customer groups, which shops a program applies to.

### 4.6 Automation

Automatic promotions, next-order coupons generated on purchase, emails on card creation or milestone.

### 4.7 Roles

POS users apply rewards; managers configure programs.

## 5. Verity today

Evidence: `verity:src/server/capabilities/crm/index.ts`, `loyalty/index.ts`, `coupon/index.ts` (each
header records the 2026-09-10 lean-scope cut); pages `/guests`, `/guests/[customerId]`, `/coupons`
(`CreateCouponForm.tsx`). `/customers` is the trading customer list (Shree Ganesh), not this client's.

| Reference item | Verity equivalent | Status |
|---|---|---|
| Customer auto-created from the bill by phone, shared across outlets | `upsertCustomerForOrder` on `generate_bill` | Built |
| Profile: name, phone, email, birthday, preferred outlet | `Customer` record | Built (no editing screen) |
| Anniversary, preferred channel, marketing consent | none | Missing |
| Customer 360: spend, visits, AOV, last order, order history | `/guests/[customerId]` (derived live from settled bills) | Built |
| Favourite items, discounts used, complaints, reviews, communication history on the 360 | not shown | Missing |
| Edit / merge customers | none | Missing |
| Segment filters: min spend, min visits, days since last order, outlet | `list_customers` filters on `/guests` | Partial — filters, not saved named segments |
| Named segments (VIP, At risk, Lapsed, New, High AOV) updating automatically | none | Missing |
| Points earned on settlement, balance, redeem | `get_balance`, `redeem_points` (points only; redemption returns a value, staff then applies a bill discount) | Built |
| HQ-configurable earn and redeem rates | `redeem_paise_per_point` config | Partial |
| Tiers, rewards catalogue, birthday / anniversary / visit rewards, expiry | not built (lean scope) | Missing |
| Coupon: code, percent or flat, minimum order value, usage limit, expiry; apply to a bill | `create_coupon`, `apply_coupon`, `list_coupons`; `/coupons` | Built |
| Buy X get Y, item or category discount, first-order, returning customer, outlet, time, segment, channel conditions | none (header lists them as not built) | Missing |
| Automatic promotions (no code) | none | Missing |

## 6. Gap decisions

Decision owner: product owner (proposed by engineering 2026-10-05, not yet confirmed).

| Item | Decision | Reason |
|---|---|---|
| Edit customer (name, email, birthday, anniversary, consent); merge duplicates | **Include** | profile data is useless if staff cannot correct it |
| Marketing consent captured and respected | **Include** | PRD §28; required before any campaign (DPDP Act in India) |
| 360 adds favourite items, offers used, points history, complaints | **Include** | PRD §29; data exists in dinein, coupon, loyalty, complaint |
| Saved named segments with rules, counts, auto-refresh; default set from PRD §30 | **Include** | PRD §30 lists them explicitly |
| One-tap redeem at the bill (redeem applies the discount itself) | **Include** | today two steps across two screens; error-prone at a busy counter |
| Earn rate configurable (₹100 = 5 points) alongside redeem rate | **Include** | PRD §31 example |
| Points expiry | **Include** | standard in both references; limits liability |
| Tiers (e.g. Silver / Gold by spend) with earn multiplier | Defer | lean-scope decision of 2026-09-10 stands until the client asks again |
| Birthday / anniversary reward (auto coupon) | **Include** | PRD §31; birthday already stored; small build on coupon + scheduler |
| Visit rewards, rewards catalogue | Defer | not needed for first loyalty release |
| Coupon conditions: outlet, channel, segment, time window, first order | **Include** | PRD §32 conditions list |
| Item / category discount, buy X get Y | **Include** | PRD §32; most common restaurant offers |
| Automatic promotions without a code (e.g. weekday lunch 10%) | **Include** | "time-specific offer" in PRD §32 |
| Gift cards, eWallet | Not applicable | not in PRD |
| Sales pipeline (Odoo `crm`) | Not applicable | walk-in diners are not leads; corporate/catering leads revisit with channels |

## 7. Verity design for this client

Inside `crm`, `loyalty`, `coupon`; `Customer` stays capability-private (not Party, per ADR-001/ADR-007,
as the CRM header records). No new platform primitive.

1. **Guest profile** `/guests/[customerId]`: edit form (name, email, birthday, anniversary, consent with
   date and source); tabs Orders, Favourites, Loyalty (balance, history, expiry), Offers used,
   Complaints; Merge with another guest.
2. **Segments** `/guests/segments`: saved rules (spend, visits per period, days since last order, first
   order date, AOV, outlet, channel, consent) with live counts; PRD §30 set preinstalled; export list
   (consented only).
3. **Loyalty settings** (HQ): earn rate, redeem rate, minimum redeem, expiry months; birthday and
   anniversary reward (coupon value, validity window).
4. **Redeem at bill:** on `/counter/[billId]`, guest balance shown; Redeem applies the discount and
   debits points in one action.
5. **Offers** `/coupons` becomes Offers: type (percent, flat, item, category, buy X get Y), code or
   automatic, conditions (minimum value, outlets, channels, segment, weekdays and hours, first order
   only), validity, usage limit per offer and per guest; usage report.

Open decision: whether offers stack (coupon plus points on one bill).

## 8. Acceptance

Module completeness bar (`docs/reference/module-completeness-bar.md`), plus live walk-through:
1. Bill a new phone number; guest created; edit to add anniversary and consent.
2. After 6 visits in a month the guest appears in Frequent; set last order 46 days ago (test data) and
   they move to At risk.
3. Earn points at ₹100 = 5; redeem 500 points on a bill in one action; balance and bill update.
4. Create "Weekday lunch 10%" automatic offer, 12–3 pm Mon–Fri, Defence Colony, dine-in only; it applies
   at 1 pm Tuesday there and not on a Zomato order.
5. Create "Buy 2 Seekh get 1 Malai free" code offer; apply; free line added.
6. On the guest's birthday a coupon is issued; using it shows on the 360 Offers tab.
