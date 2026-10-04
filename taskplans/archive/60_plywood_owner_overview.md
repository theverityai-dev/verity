# Task 60 — The owner's overview (slice 14)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §7 (overview), §8 (nothing on it is entered), §74 (drill-down).

## 1. What was missing

§7 is the most concretely specified screen in the document. It names sixteen
figures in five groups — Sales, Purchase, Inventory, Money, Tax — and says "this
is where the owner starts every day".

`ownerConsole` returned seven of them. Absent: sales this month, open orders,
awaiting credit approval, open purchase orders, pending receipt, incoming stock,
reserved, overdue, collections today, output GST, eligible ITC and tax
exceptions.

## 2. A P1 fixed on the way: the console had no godown scope

`stock_value` and `low_stock` read `stock_balance` through no filter at all. A
role restricted to one godown saw **the whole business's inventory value** on
its home screen, every morning.

The stock figures now filter by `reachableGodownIds`. The order and money
figures deliberately do **not**: an invoice is not anchored to a godown, and
inventing a filter for it would be a scope rule with no basis in the model. What
is scoped is what the model says can be.

An empty reachable set resolves to a uuid no godown can have, so it matches
nothing. Empty means nothing, never everything — the rule `scope.ts` is built
on, restated where a raw SQL statement could otherwise quietly break it.

## 3. Two figures that needed a stated rule

**Pending receipt** counts orders with something still owed, not orders that are
open. A fully received order stays open until it is closed out, and counting it
would send someone to the gate for a lorry that already came.

**Overdue** is age, not a due date. This capability records no payment terms, so
the rule is "issued more than 30 days ago and not settled" — stated on the tile
rather than dressed up as a term the business never agreed to.

## 4. Tax exceptions: null is not zero

A reader who cannot see tax gets an em dash, not a zero. "No exceptions" and
"you may not see the exceptions" are different facts, and showing the first for
the second is a false all-clear on the screen an owner trusts most.

## 5. §74's drill-down now works end to end

Receivables → Finance → an invoice → its sales order → the goods issue → the
movement ledger. Every hop in the specification's own worked example is a link
that exists, which was the point of the whole program.
