# Colonel Kebabz parity — decisions taken

Date: 2026-10-06. Taken by engineering under the product owner's instruction to decide the open
items from the available data rather than wait ("answer these decisions yourself"). Each decision
names its basis. Any of them can be reversed by the product owner; none is a constitutional rule.

Basis used throughout: Verity's target is a 10–100 person service/restaurant business, not an
enterprise (project memory: target market; lean V1 scope). Colonel Kebabz is a multi-outlet
Indian quick-service chain with a central owner. When two answers both work, the one with fewer
new concepts wins.

## Implementation decisions

| # | Question | Decision | Basis |
|---|---|---|---|
| 1 | Procurement: generalise trading purchase lines, or add purchasing to inventory? | **Inventory-native.** Add `PurchaseOrder` and `GoodsReceipt` inside the `inventory` capability. Receiving writes the existing stock movement. Trading keeps its own purchase lines untouched. Both use the same field names so a later ADR-018 merge is a rename, not a redesign. | Generalising touches the live plywood flow for a restaurant-only need. ADR-018 says extract *when a second client needs it*; today only one does. Smallest change that gets stock in. |
| 2 | Attendance kiosk PIN (identity, ADR-020) | **No PIN identity is built.** A shared outlet tablet is signed in as the outlet manager; the manager marks staff in/out from a list. The record stores `markedBy` (the manager) and `source = manager`. Staff self-service stays deferred. | A PIN is a second credential path outside ADR-020. Manager marking needs no new identity primitive, is auditable, and matches how a 10–40 person outlet actually runs. |
| 3 | Salary storage and permission | Salary lives on the HR employment record as `monthlySalaryMinor`. Reading it needs its own entity permission `verity.hr.compensation` (Read), granted to Owner and Accountant only. The outlet P&L labour line reads an aggregate through a query that returns totals, never per-person figures. | Separating the permission means a manager can run attendance without seeing pay. Aggregate-only P&L avoids leaking individuals. |
| 4 | Approval thresholds | Defaults, held as tenant configuration, not code: wastage record **over ₹2,000** is flagged on the Wastage tab for the manager to review (wastage has already happened, so it is recorded at once rather than blocked); purchase order **over ₹25,000** needs the owner; expense **over ₹5,000** needs approval (finance already has the approve command). Refunds need the manager permission and a reason; there is no refund approval workflow. Below each threshold the action just happens. | Approvals on everything is the commonest reason small teams abandon a tool. Numbers sit near typical single-outlet daily spend; the owner edits them in settings. |
| 5 | HQ price changes need approval? | **No.** HQ sets prices; outlets cannot edit them. A price change takes effect from a stated date and the old price is kept (price history). | One owner decides price. An approval step has no second person to approve it. |
| 6 | Do offers stack with loyalty points? | **No stacking.** One offer per bill. Points are earned on the amount after the discount. Redeeming points is a payment method, not an offer. | Stacking makes the bill total depend on order of application and is the usual source of "why did I pay this" disputes. |
| 7 | Include / Defer rows in the seven depth documents | **Confirmed as engineering proposed them.** | The product owner asked for decisions to be made from the data; the rows were already derived from the Odoo/ERPNext audit and the PRD. |
| 8 | Pack role names (a pack's role key becomes the client's role name verbatim) | **Keep the key as the stored name; show a humanised label** (`verity.pack.test_sample.operator` → "Operator"). No new manifest field now. | A display-name field is a manifest schema change for a cosmetic gain. Rendering the last segment gives the same result at no schema cost. |

## ADR-034 (HQ lifecycle, health, invite, support) — accepted, with one narrowing

Accepted: items 1 (health columns on the existing projection), 2 (client lifecycle state with
fail-closed suspension) and 4 (support session = reasoned, bannered "enter client").

Narrowed: item 3 (resend invitation). Verity has no invitation link to resend: a client's admin
creates each person's sign-in from People (`actions/people.ts`), and no email transport is
connected. So item 3 is built as **visibility**: HQ counts people who have never signed in (the
`people_invited` health column, the overview's "needs attention" list and the onboarding
checklist), and the operator asks the client's admin to finish them. Password reset stays with the
identity provider (ADR-020); the operator never sets a client user's password.

**Built 2026-10-06:** lifecycle with a database-guarded status column, fail-closed membership
resolution for suspended clients (and their API keys), the health columns, the needs-attention
view, and support sessions with a stated reason, a banner and an "end session" action.

## Still the product owner's, and why

Nothing above changes INV-001, ADR-017 or `enforcePolicy()`. Two things remain genuinely the
owner's because they are commercial rather than architectural: plan pricing and billing for HQ
(B-group of the HQ audit), and whether Verity should integrate Zomato/Swiggy order feeds rather
than keying platform orders by hand. Neither blocks any build below.

## HQ audit remainder (2026-10-06)

| Item | Decision | Basis |
|---|---|---|
| A2 guided onboarding | **Built** as a checklist on the client overview, computed from real state, ending in "mark active". | The steps already existed as separate tabs; a checklist joins them without a second wizard to maintain. |
| A5 support-session time limit | **Not built.** Every entry asks for a reason, is recorded in the client's trail, shows a banner, and has an "end session" action. | The operator role is narrow (identity, roles, modules, packs; no business records), so an expiry adds friction without reducing what an operator can reach. Revisit if the operator team grows past the founders. |
| A6 platform-wide failed commands | **Not built; needs its own ADR.** Scheduler runs are shown on the HQ overview. | A cross-tenant list of failures is a fourth projection, which ADR-013 forbids without a decision. |
| B1 packs | **Built:** Packs tab per client to preview, apply, upgrade, roll back and remove. | Uses the existing signed-pack control plane; plan is re-derived on the server at apply time. |
| B2 upgrades | **Built:** "Upgrade to vX" on the Modules tab for a capability pinned behind the installed version. | Uses the existing plan-and-apply upgrade operation, planned reversible. |
| B3 plans and billing for Verity | **Not built.** | Commercial: no pricing exists to model. Suspension (A3) already gives the overdue-account lever. |
| B4 adoption | **Built** as a "gone quiet" signal: a live client with no change in 14 days appears under "needs attention". | Activity counts already exist; a churn signal needs no new data. |
| B5 full export and offboarding | **Not built; needs its own ADR.** | An operator exporting every client row bypasses `enforcePolicy()` (the operator role holds no business grants), which is a security-boundary change. The client's own admin can export their reports today. |
| B6 operator team in the UI | **Not built, by design.** | ADR-013 keeps operator bootstrap off the web (`prisma/bootstrap-operator.ts`). |
| B7 announcements | **Not built; needs its own ADR.** | Messaging many clients is a cross-tenant write. |
| C1 per-client security settings | **Not built in HQ.** | API keys are the client admin's own (`create_api_key`); OIDC is installation-wide. |
| C2 compliance evidence | **Built:** the platform audit downloads as CSV (same metadata-only projection). | |
| C3 global search | **Covered for clients** (the client table filters by name). Record search across clients is not built. | Searching client records from HQ would read across tenants. |

## Internal tooling and line lists (2026-10-06)

| Item | Decision | Basis |
|---|---|---|
| Appsmith as an internal ops console | **Rejected.** Its useful ideas go on the HQ backlog instead: a data import console (spreadsheet to Verity through commands, with column mapping and validation), a support record lookup with timeline, and a cross-client implementation roll-up. | Same class as Payload in ADR-019: a second application with its own database access and stored credentials is a second tenant-isolation and authorization surface outside `enforcePolicy()` and RLS. Most proposed screens already exist in HQ (ADR-034, ADR-035). Adopting it would need its own ADR. |
| Order pad lines | Same item, portion and note on a draft order raise the line's quantity; unsent lines have a stepper and remove; after sending, removal is a void with a reason. A later round stays its own line. | A later round is a separate kitchen ticket; before sending nothing is money or work yet. |
| Bill split and refund by items | A part of a line can be picked ("1 of 3 naan"). | Splitting a shared basket of breads is the common case. |
| Stock count, finance invoice, journal, plywood board lines | **Left as typed numbers, no merging.** | A count sheet already has one row per item; invoice lines are free text; a journal may repeat an account; plywood board lines differ by size and grade. |

## Decisions recorded 2026-10-09 (Task 125 section 2)

| Item | Decision | Basis |
|---|---|---|
| Kitchen "accepted" step | **Skipped.** Moving a line to preparing is the pickup signal. | A separate accept tap adds a step on a busy line with no information the next state does not already carry. |
| Invoice photo on goods receipt | **Deferred** until storage upload is exercised inside a client. | Evidence with no file is a row claiming a photo exists (CLAUDE.md, storage note); do not ship the control before the path is proven. |
| Coupons on refund | **Not reversed.** Loyalty points are (built). | A coupon is a price concession already given on the bill; reversing it would let a refund create a second use of the same code. Points are a balance owed to the guest and must follow the money. |
| Splitting a bill | **Several payments on one GST bill, never several invoices.** | One supply, one tax invoice; the payment split is a settlement detail, not a tax event. |
| Default accent | **Blue `#0A84FF` for every client.** A client gets another preset only if they ask. | Product owner, 2026-10-09; ADR-033 keeps the tint configurable through presets. |
| Platform nav icons | **A capability may only name an icon in the closed set; a test enforces it.** | Seven items shipped with no glyph because unknown names were dropped silently (`nav-icons.test.ts`). |
