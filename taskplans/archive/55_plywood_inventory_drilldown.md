# Task 55 — Inventory drill-down (connected-experience slice 9)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §10 (product detail), §11 (godowns), §12 (stock), §13 (movement
ledger), §17 (low stock), §64–65 (damage and physical adjustment).

## 1. What was missing

A quantity was an assertion. `/stock` showed that a godown held 142 sheets and
offered no way to ask why, even though the append-only ledger that answers the
question has existed since slice 1. §13 calls that ledger "critical for
warehouse staff and accountants" and there was no route to it.

Nor was there a product page. §10 asks that one screen connect a board's stock,
both sides of its pricing, its open orders and its movement history; the
catalogue listed products and led nowhere.

## 2. Delivered

**A new module, `views.ts`** — read-only projections, kept out of `stock.ts`
deliberately. `stock.ts` maintains the ledger and the balance it summarises;
mixing page-shaped reads into it would put layout concerns in the module that
guards the append-only invariant.

- `productDetail` — §10. On hand, reserved, available, incoming, weighted
  average cost, stock by godown, supplier and customer pricing, open purchases,
  open sales, recent movements.
- `godownDetail` — §11. Value, quantities, racks, stock by product, expected
  deliveries, recent movements.
- `stockLedger` — §13. Oldest first with a running balance.

**Routes.** `/catalogue/[productId]`, `/godowns/[locationId]`,
`/stock/[productId]` (with `?godown=` to scope it).

**Entry points.** The catalogue, the stock board and its per-godown panels now
link into these. A drill-down nobody can reach is not a drill-down.

**`components/ui/business/movements.ts`** — the eight movement kinds in a
warehouse's words, and `movementHref`.

## 3. A P0 found and fixed: `productMovements` had no row scope

`stockOnHand` filters by `reachableGodownIds` and carries a comment saying why:
without it a godown-scoped role reads every godown's stock. `productMovements`
read the same facts from `stock_ledger_entry` and applied **no such filter**.

So a warehouse operator restricted to Noida could read the movement history of
every godown in the business — quantities, unit costs, and the orders behind
them — by asking for a product. Layer 1 passed, which is exactly what made it
look authorized. This is audit finding P0-01 surviving in a handler the original
sweep missed.

Fixed, and the three new queries all filter on the way in. `stockLedger`
*intersects* an explicit `locationId` with the reachable set rather than letting
it replace the set, so naming another branch's godown returns nothing instead of
returning its ledger.

`godownDetail` returns `null` for an out-of-scope godown, and the route renders
that as not-found rather than as forbidden. Distinguishing the two would tell an
operator that a site they may not read is nevertheless there — the fact the
scope existed to withhold.

## 4. Movement links resolve rather than guess

A movement's `sourceId` is a goods receipt or a goods issue, and neither is an
order. Building `/purchases/<receiptId>` from one would be a confident link to
a 404. The queries resolve receipt → purchase order and issue → sales order in
one batched lookup per page and return `sourceOrderType` / `sourceOrderId`;
`movementHref` only formats what the server resolved.

An adjustment, a damage record and a manual transfer have no source document.
They render as plain text, which is honest — §64 and §65 want the *reason*
visible, and the reason is carried on the movement itself.

## 5. Deviation recorded: there is no sell price

§10 shows a single "Sell Price" beside the average cost. This capability has no
such field, deliberately: a price is agreed per customer
(`PlywoodCustomerPrice`) or stated on the order. Inventing a list price would
create a number the business never quotes and that no command maintains — a
fake fact on a valuation screen.

What the product page shows instead is `lastSoldPricePaise`, taken from the most
recent invoice line, and the per-customer prices in full. A fact rather than a
policy. If the business later wants a list price it is a command and a column,
not a display decision.

## 6. Arithmetic stated once

The product's average cost is value over units, not the mean of the per-godown
averages: 100 sheets at ₹1,000 in one godown and 1 sheet at ₹2,000 in another
average to ₹1,010, not ₹1,500. Guarded at zero stock, because 0/0 is not zero.

`lowStock` requires `reorderLevelUnits > 0`. A product with no level set has not
opted in to alerting and must not raise one.
