# Task Plan 126 — URY gap closure: restaurant operations

**Authority:** Product-owner request, 2026-10-09 ("map all gaps, plan out properly which ones and how
to adapt in verity make documents for that complete adrs i'll approve it then build it"). Grounded in
`docs/reference/ury-parity/ury-vs-verity-a-to-z.md` (the comparison this plan acts on), ADR-040 to
ADR-043 (written with this plan), the Colonel Kebabz parity set
(`clients/colonel-kebabz/reference-parity/`, `DECISIONS.md`) and the Task 125 register. Stop conditions:
`CLAUDE.md`. Anything that adds a security boundary needs its ADR approved before code; Wave 5 does.

## Status: PROPOSED 2026-10-09 — plan and four ADRs written, nothing built, awaiting approval

Evidence: the plan and ADRs are the only artefacts. Waves 0 and 1 need no ADR and can start on the
product owner's word; Waves 2 to 5 each wait for their ADR to be approved (ADR-040, 041, 043, 042).

Scope note: `CLAUDE.md` lists Sales, Inventory, Commerce and Finance as out of scope for the platform
foundation, and the 2026-09-30 scope decision names only Tasks 118 to 120. Colonel Kebabz's restaurant
capabilities were built under the Task 84 override and Task 125. This plan extends **those existing
capabilities only** (`dinein`, `recipe`, `crm`, `finance`). It adds no new business capability and no
platform primitive; the one shared piece (the number allocator) is an extraction under ADR-018's rule.

## 1. Method

The comparison document maps 80-odd capabilities, A to Z, with evidence on both sides. This plan turns
every row that is not "parity" or "Verity ahead" into a numbered gap (§2), gives each a disposition, and
for every "build" says how it is adapted into Verity's own terms (§4). Silence is not allowed: every gap
lands in exactly one disposition.

Dispositions: **Fix** (a defect), **Build** (no ADR needed), **Build after ADR**, **Defer** (with a
trigger that reopens it), **Do not copy** (URY has it; Verity's position differs on purpose),
**Verify** (not enough evidence yet), **Neither** (URY has no real implementation either).

## 2. Gap register

| ID | Gap | URY has | Verity today | Disposition | ADR | Wave |
|---|---|---|---|---|---|---|
| G-01 | `sales_summary` ignores `day` | n/a | Regex lacks backslashes (`dinein/index.ts:2395`) | **Fix** | — | 0 |
| G-02 | Service days overlap and the cutoff is hard-coded | per-branch `hours` cutoff | Day D runs 00:00 to D+1 05:00, so 00:00 to 05:00 counts in two days | **Fix** (0), configurable (2) | 040 | 0, 2 |
| G-03 | Bill has no legal number or seller identity | invoice series per restaurant | Label is a UUID fragment; no GSTIN/FSSAI/legal name | **Build after ADR** | 040 | 2 |
| G-04 | One tax rate pair for the whole bill | any ERPNext tax template | Tenant-wide CGST/SGST | **Build after ADR** | 040 | 2 |
| G-05 | Refund is not a credit note | ERPNext return | Append-only refund, no number or tax reversal | **Build after ADR** | 040 | 2 |
| G-06 | Platform-order tax treatment | "invoice without tax" flag | One treatment for all channels | **Build after ADR** | 040 | 2 |
| G-07 | Service charge | via tax template | None; overpayment refused | **Build after ADR** | 040 | 2 |
| G-08 | Restaurant sales reports | 17 reports | No page reads the restaurant sales data | **Build** | — | 1 |
| G-09 | Outlet "today" dashboard | KPIs, attention, shift metrics, baseline, floor load, service line, running low | Counter has 3 tiles | **Build** | — | 1 |
| G-10 | Daily P&L fixed-cost allocation | electricity meter, daily fixed, % expenses, depreciation | Range P&L; one-off expenses | **Build** (lean form) | — | 1 |
| G-11 | Tax screens do not include dine-in | n/a (ERPNext) | `/tax/*` reads trading invoices only | **Build after ADR** | 040 | 2 |
| G-12 | Kitchen stations | production units by item group | One queue per outlet | **Build after ADR** | 041 | 3 |
| G-13 | Courses and serve order | menu course + priority | Categories only | **Build after ADR** | 041 | 3 |
| G-14 | Kitchen ticket, print, reprint | KOT doc + QZ/network/websocket | No ticket; bill browser print only | **Build after ADR** (browser print) | 041 | 3 |
| G-15 | Void after fire is invisible to the cook | red cancelled card + confirm | Line leaves the board | **Build after ADR** | 041 | 3 |
| G-16 | Station sound, channel colours | audio alert, colour-coded cards | None | **Build after ADR** | 041 | 3 |
| G-17 | Outlet red flags and delay alerts | needs-attention + role notify | HQ list only; SLA urgency on board | Panel **Build** (W1); push **Defer** to ADR-039 build | 039 | 1, 5 |
| G-18 | Captain transfer | transfer dialog | No hand-over command | **Build** | — | 1 |
| G-19 | Table-age badge and attention colour | attention time on card | None on floor card | **Build** | — | 1 |
| G-20 | Table geometry, room type; unmerge | width/height, AC, merge cluster | x,y,shape; no unmerge | Geometry **Build**; unmerge **Do not copy** | — | 1 |
| G-21 | Favourite items per guest | top three | None | **Build** | — | 1 |
| G-22 | Print-before-submit gate | hard gate | Not present | **Do not copy** | — | — |
| G-23 | Cashier shift sessions (float, per-mode count) | POS opening/closing entry, sub-cashiers | Outlet-day cash reconciliation | **Defer** | — | — |
| G-24 | Opening/closing checklists | gated, logged | None (PRD §56–57) | **Build** (not a gate) | — | 1 |
| G-25 | Daily-reset order number | order number resets daily | Not verified for orders | Covered by ticket number (ADR-041) | 041 | 3 |
| G-26 | Price by outlet / channel | menu per room/order type, price lists | One price per item | **Build after ADR** | 043 | 4 |
| G-27 | Priority / special dish flag | `special_dish` | None | **Build** | — | 1 |
| G-28 | Combos and bundles | Product Bundle | None | **Defer** | — | — |
| G-29 | Item photos on the pad | item images | No image column | **Defer** (blocked on storage) | — | — |
| G-30 | Customer self-order (QR, pickup, kiosk) | four modes | Channel labels only | **Build after ADR** | 042 | 5 |
| G-31 | Call waiter / request bill | service request | None | **Build after ADR** | 042 | 5 |
| G-32 | Payment terminals | simulated provider only | Record-only | **Neither** → **Defer** | — | — |
| G-33 | Offline mode | claimed, no code found | Substrate, no UI | **Neither** → **Defer** | — | — |
| G-34 | Languages and right-to-left | en, fr, ar | English only | **Defer** | — | — |
| G-35 | Setup wizard and demo restaurant | wizard + demo data | HQ checklist, packs, import | **Defer** to a signed pack | — | — |
| G-36 | POS profile switches | per-counter | roles and permissions | **Do not copy** | — | — |
| G-37 | Per-mode till count | closing entry per mode | cash only | **Defer** with G-23 | — | — |
| G-38 | Notification dispatch | KOT delay notify | none (ADR-039 accepted) | Dependency, Task 125 7.7 | 039 | 5 |
| G-39 | Unit-of-measure depth | UOM conversions | item unit label | **Verify** | — | 1 |
| G-40 | Reservations | none | manual `reserved` state | **Neither** → **Defer** | — | — |
| G-41 | Tips | none | refused | **Defer** (service charge in G-07) | — | — |

Counts of the 41 rows: 2 fixes (G-01, 02); 10 builds without an ADR (G-08, 09, 10, 17 panel, 18, 19,
20 geometry, 21, 24, 27); 14 builds after an ADR (G-03 to 07, 11 to 16, 26, 30, 31); 10 deferred (G-23,
28, 29, 32, 33, 34, 35, 37, 40, 41); 3 do-not-copy (G-20 unmerge, G-22, G-36); 1 verify (G-39); 2
dependencies on other work (G-25 on ADR-041's ticket number, G-38 on ADR-039). G-17 and G-20 appear twice
because each row has two dispositions; the table is the authority.

## 3. Sequence and dependencies

```
Wave 0  fixes (G-01, G-02)                         no ADR     hours
Wave 1  reports, today, small floor items          no ADR     largest user-visible win
Wave 2  GST bill (ADR-040)                         ADR       compliance; unlocks business day and outlet profile
Wave 3  kitchen stations, courses, tickets (041)   ADR       needs the number allocator from Wave 2
Wave 4  scoped prices (043)                        ADR       independent; needs business day from Wave 2
Wave 5  self-order (042)                           ADR       needs Waves 2, 3 and ADR-039's in-app channel
```

Waves 0 and 1 can start immediately and run while ADRs 040 to 043 are reviewed. Wave 2 is placed before 3
because the ticket number reuses its allocator and because a numbered tax invoice is a legal exposure the
client already has today. Wave 4 may swap with Wave 3 if Colonel Kebabz asks for Zomato pricing sooner.

Process rules (Task 125): commit as work lands, push once at the end of a wave; apply each migration to
production before the push that needs it; confirm CI, `/api/health` and `/api/ready`; add append-only
tables to the conformance sorted list; screens with lines follow the "Line-list basics pass" in the
`verity-usage-qa` skill. Every migration here is additive.

## 4. How each wave adapts into Verity

Naming follows the repo: commands and queries are `verity.dinein.*` unless stated; entities live under
`src/server/capabilities/<capability>/`; pages under `src/app/(shell)/`.

### Wave 0 — fixes (no ADR)

| Step | Change | Proof |
|---|---|---|
| 0.1 | Correct the date test in `serviceDayRange` to `/^\d{4}-\d{2}-\d{2}$/` (G-01) | New DB test: `sales_summary` with yesterday's `day` returns yesterday's bills |
| 0.2 | Make a service day `[D at start, D+1 at start)` with a named constant start of 05:00 so days no longer overlap (G-02). Check every caller of `serviceDayRange` first (cash reconciliation, outlet P&L, counter) and list the figures that change | Test: a bill settled at 02:00 appears in exactly one day |

Decision recorded: until the outlet profile exists, the start stays 05:00 (the value already in the
code), so a night-service outlet's 00:00 to 05:00 bills belong to the previous day, once.

### Wave 1 — reports, today, small floor items (no ADR)

Each is a read query plus a page, or a small additive command. No platform change.

| Step | Gap | Adaptation |
|---|---|---|
| 1.1 | G-08 | Query `verity.dinein.sales_report` with `view` = day, month, hour, item, channel, staff, cancelled, average bill; inputs: range, outlet. Reads settled bills, lines, payments, refunds; revenue is net of refunds, the same basis as the outlet P&L. Page `/sales-reports` with a tab per view, `DataTable`, permission Read on bill. Repeated guests link to `/guests`. Retire the stale `salesSummary` comment in `reports/page.tsx` |
| 1.2 | G-09, G-17 | Query `verity.dinein.outlet_today` and page `/today` (the dine-in landing route for managers): sales, bills, average bill, covers, average per cover, average ticket minutes (order `placedAt` to `servedAt`), tables seated of total; needs-attention list (orders unpaid over N minutes, tables seated over N minutes, orders still open from before the service-day start, closing checklist unfinished); baseline (median sales and covers for this weekday and hour over six weeks); floor load per waiter; service line per table (free, seated, with kitchen, ready, served, over 75 minutes); items running low from the inventory low-stock source. Thresholds are ConfigParameters (`verity.dinein.alerts.unpaid_minutes` = 15, `seated_minutes` = 60), editable in Settings |
| 1.3 | G-10 | `expense.periodFrom` and `periodTo` (nullable). The outlet P&L prorates an expense across its period the way it already prorates salaries (`src/lib/labour-cost.ts` pattern); expense form gets "covers from / to". **Decision: no meter-reading entry** — electricity is recorded as an expense for its billing period. Migration `finance_expense_period` |
| 1.4 | G-18 | Command `verity.dinein.hand_over_order` (Edit on order): new taker must hold Read on orders at that outlet; writes `takenByUserId`; audited with from, to, reason. Button in the order's table actions |
| 1.5 | G-19 | `list_floor` returns minutes since the open order was created; floor card shows it and switches to the warning tone at the `seated_minutes` threshold |
| 1.6 | G-20 | `dining_table.width` and `height` (integers, default 1 grid unit) and a resize handle in `/floor/setup`; room type (AC or non-AC) as a declared custom field on `dining_zone` (PLA-EXT-001), no migration. **Unmerge not built** (see §6) |
| 1.7 | G-21 | Query `verity.crm.get_customer_favourites` (top three items by quantity over settled orders for the guest's phone, following merged-guest links). Shown on the guest page and on the order pad when the order has a customer phone |
| 1.8 | G-24 | Two Checklist templates per outlet (Opening, Closing) through the existing template definition and instance model (`schema.prisma` TemplateDefinition kind Checklist); a screen to complete today's checklist, recorded with who and when. **Not a gate** (§6): an unfinished closing list appears in 1.2's attention list and on cash reconciliation. A restaurant seed provides the two templates; the client edits the items |
| 1.9 | G-27 | `menu_item.featured` boolean; the order pad gets a "Specials" chip filter. Migration `dinein_menu_item_featured` |
| 1.10 | G-39 | Verify unit-of-measure depth in `inventory` against PRD §68–69; write findings into the comparison document. No code |

Migrations: `finance_expense_period`, `dinein_table_size_and_featured` (one file for 1.6 and 1.9).
Acceptance: rows 1 to 12 of `docs/reference/module-completeness-bar.md` for the new pages; a live walk
as the demo admin with real orders; 390px pass on `/today` and `/sales-reports`.

### Wave 2 — GST bill (ADR-040)

Order inside the wave, each step shippable:

| Step | Change |
|---|---|
| 2.1 | Extract the pure allocator to `src/server/runtime/document-number.ts`; trading's `nextDocumentNumber` becomes assert + allocate. Trading tests pass unchanged |
| 2.2 | Migration `dinein_gst_bill`: `outlet_profile`, `bill_tax_line`; columns `menu_item.tax_rate_bp`, `order_line.tax_rate_bp`, `bill.number` (nullable), seller snapshot columns, `bill_refund.credit_note_number` and tax-reversal columns. RLS forced on both new tables; credit-note numbering rows covered by the conformance lists |
| 2.3 | Settings screen "Outlets": code, legal name, GSTIN, state, registration type, FSSAI, address, day start, service-charge rate, platform-tax switch, cutover date. **Rollout rule: an outlet with no profile keeps today's behaviour**, so nothing changes until the owner fills it in |
| 2.4 | `generate_bill` rewritten to compute tax per line, write `bill_tax_line` rows, allocate the number, snapshot the seller. Existing total columns stay |
| 2.5 | Service charge line and per-bill waive command; platform-channel tax switch |
| 2.6 | Refund creates a credit note with its own series and tax reversal per rate |
| 2.7 | Bill and credit-note print views carry number, seller identity, SAC 9963 text, rate-wise tax table |
| 2.8 | Business day from the outlet profile replaces Wave 0's constant (G-02 closed) |
| 2.9 | `/tax/*` reads dine-in bills and credit notes as B2C by rate (G-11) |

Tests: allocator (gapless under concurrency, rollback returns the number), tax per rate with service
charge apportionment to the paisa, refund by items reverses the same split, snapshot survives a profile edit,
no-profile outlet unchanged, RLS isolation for both tables.
Acceptance: the client's tax adviser confirms the open points in ADR-040 before the cutover date is set.

### Wave 3 — kitchen (ADR-041)

| Step | Change |
|---|---|
| 3.1 | Migration `dinein_kitchen_stations`: `kitchen_station`, `kitchen_station_category`, `menu_course`, `menu_item.course_id`, `order_line.station_id`, course snapshots, `order_line.kitchen_ack_at` |
| 3.2 | Menu: Courses and Stations setup (category to station); kitchen readiness check in outlet setup |
| 3.3 | `add_order_lines` routes each line to its station and snapshots course; board gets `?station=`, course badge, course sort |
| 3.4 | Migration `dinein_kitchen_tickets`: `kitchen_ticket`, `kitchen_ticket_line` (append-only); ticket written per station by `place_order`, `add_order_lines` and a post-fire `void_order_line`; ticket number from the Wave 2 allocator with the service day as the period |
| 3.5 | `/kitchen/ticket/[ticketId]` 80 mm print view; "auto print new tickets" station mode; `reprint_ticket` (audited, counted, stamped REPRINT) |
| 3.6 | "Cancelled, confirm" lane; acknowledge command stamps `kitchen_ack_at` |
| 3.7 | Sound on new ticket and channel colours as per-device preferences (G-16) |

Tests: routing snapshot survives remapping; void-after-fire shows until acknowledged; a queued void just
leaves; ticket numbers restart per service day; ticket and join rows reject update and delete.
Acceptance: a live service-simulation with two stations, a course sequence, an addition and a void.

### Wave 4 — scoped prices (ADR-043)

| Step | Change |
|---|---|
| 4.1 | Migration `dinein_menu_price_rule` (RLS forced) |
| 4.2 | Pure resolver `src/lib/menu-price.ts` beside `menu-availability.ts`, tests mirroring its tests (specificity, tie, window, time zone, business day) |
| 4.3 | `listMenu` and `addOrderLines` use it; the pad shows the rule name; unavailable and price reasons come from one place |
| 4.4 | Menu "Prices" tab; price history includes rule changes; overlap warning |

Acceptance: a Zomato-priced item shows the Zomato price on a platform order and the base price on dine-in,
and the bill snapshot is unchanged after the rule is ended.

### Wave 5 — self-order (ADR-042; dark by default)

| Step | Change |
|---|---|
| 5.1 | Prerequisite check: ADR-039's in-app channel built (Task 125 7.7); Waves 2 and 3 live |
| 5.2 | Migration `dinein_self_order`: `self_order_session`, `self_order_submission` (+ lines), `service_request`, `verity.self_order_lookup(token_hash)` definer function; `outlet_profile.self_order_enabled` |
| 5.3 | Outlet setup: provision the "Self order, <outlet>" identity and `Self Order Guest` role through the ordinary People flow; readiness check |
| 5.4 | Public routes (read menu and own session, one POST), throttled, 404 when disabled, anonymous-visitor tests against a live server (as ADR-030 did) |
| 5.5 | Staff side: pending-submission queue on the pad (accept runs `add_order_lines` as the accepter, reject with reason), floor badge for open service requests, sticker print page |
| 5.6 | Retention job (30 days) on the scheduler |

Tests: wrong, expired and closed tokens answer identically; the sticker alone cannot order at an empty
table; a seated table applies lines directly, an unseated one queues them; prices and availability cannot be
forged; the ordering identity can do nothing but its allowlist; a body cannot name another tenant or outlet.

## 5. Deferred, with the trigger that reopens each

| Gap | Why deferred | Trigger |
|---|---|---|
| G-23 / G-37 cashier shifts, per-mode count | Outlet-day cash reconciliation matches a 10 to 40 person outlet; a shift model adds a gate on selling | A client runs two cashiers on one shift and asks per-cashier variance |
| G-28 combos | Changes the order line (one line, several kitchen and stock components) | A client asks for combo pricing; design needs its own ADR |
| G-29 item photos | Evidence with no file is a claim (DECISIONS 2026-10-09) | Storage upload proven inside a client |
| G-32 payment terminals | URY ships only a simulated provider; `GOV-SCO-006` | A client names a terminal vendor |
| G-33 offline mode | URY has none either; substrate exists | A client with unreliable connectivity |
| G-34 languages, right-to-left | English only is enough for current clients | A client outside India or a non-English floor |
| G-35 sample restaurant | A signed pack (ADR-022) should be built after Waves 1 to 3 so it contains stations and courses | Second restaurant client |
| G-40 reservations | Neither system has them | A client wants bookings |
| G-41 tips | Service charge covers the stated need | A client asks |
| Print agent | See ADR-041 item 6 | A client cannot use silent browser printing |
| Per-zone pricing, percentage mark-ups | See ADR-043 | A client asks |
| IGST | See ADR-040 item 5 | Inter-state catering or corporate supply |

## 6. Decisions proposed (basis recorded; any can be reversed by the product owner)

| # | Decision | Basis |
|---|---|---|
| D1 | Do not build cashier shift sessions now | Day-level reconciliation exists and a shift gate adds friction for 10 to 40 person outlets; lean V1 (project memory) |
| D2 | Do not copy print-before-submit | It blocks recovery when a printer fails; the bill is printable at any time and a warning on the counter suffices |
| D3 | Do not copy per-counter POS profile switches | Roles and permissions already answer each (who may discount, void, edit); a second mechanism would drift |
| D4 | Opening and closing checklists are recorded, not gating | URY blocks the POS; Verity surfaces an unfinished list in the attention view and cash reconciliation, which keeps the till usable if someone forgets |
| D5 | No meter-reading entry in the P&L | An electricity bill is an expense with a period; prorating it gives the same daily cost without a new input form |
| D6 | Do not build table unmerge | Merging moves lines onto one order and the audit trail records it; the real need after a merge is to split the payment, which exists |
| D7 | Station is a view, not a permission scope | A cook seeing one station is a convenience; role-by-station multiplies roles (ADR-041) |
| D8 | Bills before the cutover keep their legacy label | Rewriting issued bills' identity is a tax-adviser question (ADR-040) |
| D9 | Wave 0 keeps a 05:00 day start until the outlet profile exists | It is the value already in the code; only the double-counting changes |

## 7. For the approver

1. **Approve or amend ADR-040, 041, 043, 042** (each file lists its own open points).
2. **Give the outlet codes** for the three Colonel Kebabz outlets (at most three characters each) and say who
   at the client confirms the tax points in ADR-040 with their adviser.
3. **Say whether to start Waves 0 and 1 now**, while the ADRs are reviewed. They touch no schema except two
   small additive migrations and need no approval beyond this plan.
4. On approval of an ADR: set its status to ACCEPTED with the date, update `CLAUDE.md`'s register line, mark
   this plan's wave as authorised, and build that wave only.

## 8. Reporting vocabulary

Everything above is **NOT YET BUILT**. Evidence for the gaps is in the comparison document; the "Verity
today" column was read from code at commit `c1daa430` and a few items are marked Verify. The self-order
design (ADR-042) exists on paper only.
