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
| 4 | Approval thresholds | Defaults, held as tenant configuration, not code: wastage record **over ₹2,000** needs a manager's approval; purchase order **over ₹25,000** needs the owner; expense **over ₹5,000** needs approval (finance already has the approve command). Refunds need the manager permission and a reason; there is no refund approval workflow. Below each threshold the action just happens. | Approvals on everything is the commonest reason small teams abandon a tool. Numbers sit near typical single-outlet daily spend; the owner edits them in settings. |
| 5 | HQ price changes need approval? | **No.** HQ sets prices; outlets cannot edit them. A price change takes effect from a stated date and the old price is kept (price history). | One owner decides price. An approval step has no second person to approve it. |
| 6 | Do offers stack with loyalty points? | **No stacking.** One offer per bill. Points are earned on the amount after the discount. Redeeming points is a payment method, not an offer. | Stacking makes the bill total depend on order of application and is the usual source of "why did I pay this" disputes. |
| 7 | Include / Defer rows in the seven depth documents | **Confirmed as engineering proposed them.** | The product owner asked for decisions to be made from the data; the rows were already derived from the Odoo/ERPNext audit and the PRD. |
| 8 | Pack role names (a pack's role key becomes the client's role name verbatim) | **Keep the key as the stored name; show a humanised label** (`verity.pack.test_sample.operator` → "Operator"). No new manifest field now. | A display-name field is a manifest schema change for a cosmetic gain. Rendering the last segment gives the same result at no schema cost. |

## ADR-034 (HQ lifecycle, health, invite, support) — accepted, with one narrowing

Accepted: items 1 (health columns on the existing projection), 2 (client lifecycle state with
fail-closed suspension) and 4 (support session = reasoned, bannered "enter client").

Narrowed: item 3 (resend invitation). No email transport is connected, so "resend" is built as
**"show the invitation link to the operator to pass on"**, through the same path and with the same
ADR-007 verification rules. It does not claim a message was delivered. Real email delivery is a
separate deployment decision and is not part of this ADR.

## Still the product owner's, and why

Nothing above changes INV-001, ADR-017 or `enforcePolicy()`. Two things remain genuinely the
owner's because they are commercial rather than architectural: plan pricing and billing for HQ
(B-group of the HQ audit), and whether Verity should integrate Zomato/Swiggy order feeds rather
than keying platform orders by hand. Neither blocks any build below.
