# Task 71 — Plywood transaction desks and finance automation

Authority: Bible V2 Primitive 2 (commands/events), ADR-011 / ADR-012 (material
system and accent), ADR-009 (StateCategory), INV-001, INV-002.
Product owner instruction, 2026-09-01.

## The complaint, in the owner's words

1. Dropdowns are native selects — want type-ahead search and filter.
2. Text fields in the "New supplier" row are misaligned.
3. "Add supplier" belongs on Suppliers, not Purchases.
4. Receiving should offer only the ordered lines.
5. A purchase must be able to carry several boards.
6. Creating things should open a popup, not push a new section into the page.
7. Raising a purchase order should create the money side by itself, and offer
   "record payment". Today it refuses with *"nothing has been received against
   this purchase order, so there is nothing to invoice"*.
8. An agreed supplier price should prefill cost per unit.
9. Discount percentage on purchase and sales lines.
10. Finance is unlinked and errors on every attempt. It must be automatic: a
    clerk records purchases, sales and the money that moves — nothing else.
11. Payment recording must be party-first: paid or received, to or from a
    supplier or customer, an amount, and the books settle themselves.

## What is already true

(4) is already implemented — `ReceiveForm` in `PurchaseDesk.tsx` renders the
order's own outstanding lines and nothing else, from Task 69. Verified before
planning. Nothing to do beyond moving it into the modal of item (6).

Item (7)'s refusal is *correct as an accounting rule* and wrong as a workflow:
an invoice for goods that have not arrived is how a business pays for a
delivery it never received. The fix is not to delete the guard. It is to stop
making a human raise the invoice at all — see slice D.

## Design decisions

**D-1. A purchase order is a commitment, not a payable.** Ordering does not
create a liability; delivery does. So the money side is created automatically
at *goods receipt*, not at order creation. The desk shows the committed value
before then, labelled as on order, so the owner sees "we will owe them this"
without the books claiming a debt that does not exist yet.

**D-2. The auto-raised supplier bill is provisional.** `raise_purchase_invoice`
documents that a supplier's figure is "transcribed rather than computed", and
that is right: what you owe is what they billed. But waiting for their paper
before the payable exists is what makes finance feel unlinked. So receipt
raises a bill computed from the order's own agreed prices and the effective
HSN tax rules, flagged `isProvisional`. When the supplier's document arrives,
`confirm_purchase_invoice` records their number and their figures and clears
the flag. Provisional bills are listed separately and are excluded from GSTR
input-credit claims until confirmed — a computed tax split must never be filed
as though a supplier had issued it.

**D-3. Payments are party-first and allocate FIFO.** `record_payment` today
requires an `invoiceId`, which is why the desk feels like accounting software.
The new `record_party_payment` takes direction, party, amount, method and date,
then allocates oldest-invoice-first. A surplus is not refused: it becomes an
on-account balance, which is what an advance is. The per-invoice command stays
for the case where a payment is genuinely against one document.

**D-4. Discounts are stored as basis points on the line, and the discounted
unit price is what everything else reads.** Storing a percentage and
recomputing at read time would let a rate change rewrite a placed order. The
line keeps `discountBps` for display and `unitCostPaise` / `unitPricePaise` as
the *gross* figure, plus `netUnitPaise` derived once at write time.

**D-5. Modals, not inline panels.** One `Modal` primitive. Glass at the
elevated material level for the dialog surface (ADR-011); the form inside stays
solid, because it is a dense form and ADR-011 says those do.

**D-6. Alignment is a grid problem, not a padding problem.** The screenshot's
misalignment is `items-end` on a flex row: a field with a hint under its input
is taller, so aligning bottoms pushes its label and input *up*. Fixed with a
three-row subgrid — label row, control row, hint row — so every field in a row
shares the same three baselines whether or not it has a hint.

## Slices

- **A — primitives.** `Modal`, `Combobox` (type-ahead, ARIA combobox), `FormGrid`
  + `Field` subgrid alignment. Items 1, 2, 6.
- **B — schema.** `discountBps` + `netUnitPaise` on both order-line tables;
  `PlywoodPayment.invoiceId` nullable plus `customerId` / `supplierId` /
  `direction`; `PlywoodPaymentAllocation`; `PlywoodInvoice.isProvisional`.
  Items 9, 11.
- **C — server, purchases.** Auto-raise provisional supplier bill at receipt;
  `confirm_purchase_invoice`; agreed-price resolution exposed to the form.
  Items 7, 8.
- **D — server, sales + money.** Auto-raise the sales invoice at goods issue;
  `record_party_payment` with FIFO allocation and on-account surplus. Items 10, 11.
- **E — desks.** Purchases (multi-line modal, discount, prefill), Sales (same),
  Suppliers (new-supplier modal moves here), Finance rebuilt around payables,
  receivables and one Record payment action. Items 3, 5, 6, 10.

Each slice ships with tests and is committed on its own.

## Delivered

| # | Complaint | Where it landed |
|---|---|---|
| 1 | Native dropdowns, want type-ahead | `src/components/ui/Combobox.tsx` (+ `FormCombobox` for uncontrolled forms). Every entity picker on the plywood desks, ledgers, stock, godowns and both order views. A two-option select — the stock-correction direction — stays native, where a search box would be worse. |
| 2 | Misaligned text fields | `FormRow` + `.verity-field` subgrid in `globals.css`. Cause was `flex items-end`: a field with a hint is taller, so aligning bottoms pushed its label and control up. |
| 3 | Add supplier belongs on Suppliers | `SupplierList.tsx` owns it now, including from the empty state; removed from `PurchaseDesk`, along with the supplier table that duplicated `/suppliers`. |
| 4 | Receive only the ordered lines | Already true since Task 69; moved into the modal. |
| 5 | Several boards on one purchase | `NewPurchaseOrderForm.tsx`. |
| 6 | Popups, not new page sections | `src/components/ui/Modal.tsx` on the native `<dialog>`. New supplier, new order (both sides), agree a price, receive, cancel, record payment, confirm a supplier bill. |
| 7 | Purchase should create the money side | `issueProvisionalPurchaseBill`, called from `receiveGoods` when the order completes. The old refusal is intact and no longer reachable by an ordinary user. |
| 8 | Agreed price should prefill | `supplierPrices` query; the form fills the cost and shows the agreed figure on the option itself. |
| 9 | Discount percentage | `discountBps` + `listUnit*Paise` on both order lines; `unit*Paise` stays the net. |
| 10 | Finance is unlinked and errors | `FinanceDesk` rebuilt around `partyBalances`; raising a document by hand survives only as a retry on a failed automatic raise, with the reason shown. |
| 11 | Party-first payment recording | `recordPartyPayment`, FIFO allocation through `plywood_payment_allocation`, surplus kept on account. |

## Deliberately not done

- **A bill per delivery.** `plywood_invoice_one_per_purchase_order` allows one invoice
  per order and an invoice is immutable, so a bill raised on the first of three
  deliveries could never grow. Changing that is a schema decision with GST
  consequences and belongs to its own task. Until then a part-delivered order shows
  its received value as `Not yet billed`, which is the truth.
- **Weakening invoice immutability.** Confirming a supplier's document appends a
  confirmation row; it does not edit the bill. A money difference is a note.
- **Blocking a receipt on a billing failure.** Stock arriving is a physical fact. A
  missing state code makes the bill impossible, not the delivery, so the receipt
  stands and the reason is returned and shown.
