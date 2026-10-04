# Task 70 — Second-pass audits: UI craft, and function

Two audits run after the Task 69 remediation, as commissioned: one on visual
craft, one on behaviour. Both hands-on against the running app and the real
tenant **Shri Ganesh Timber Trading Co.**

Method mattered here. The first audit read screens through the accessibility
tree; this one added **screenshots at 1440×900 and 390×844** and **measured
geometry in the page**. Three of the six findings below are invisible to a
snapshot and were only found by looking, or by measuring.

---

## Part 1 — UI craft

### C-1 · Numeric columns wrapped mid-value
`"300 sheets"` broke across two lines in a column that narrow, and so did the
`"Order value"` header, leaving the purchases table visibly ragged.

Caused by my own Task 69 fix: adding the unit to every cell to resolve U2-3.
The unit belongs once, in the caption. Cells now carry plain tabular figures and
nothing in a numeric column wraps.

### C-2 · Five navigation items shared three glyphs
Finance and Ledgers were both a bar chart. Suppliers and Customers were both the
two-figure mark, sitting adjacent in TRADE. Overview was a generic list.

Adjacent items that look identical make a sidebar unreadable at a glance, which
is the one thing a sidebar is for. Added a banknote, a ruled book, and a
crate-with-arrow; pointed Overview at the house glyph it already had.

### C-3 · **Mobile was broken, not merely tight** — the worst of this pass
A seven-column table has no scroll container, so at 390px it was **clipped by
its panel rather than scrolled**. The value column and *both* action buttons sat
off-screen and unreachable, with nothing indicating more existed. A phone user
could not cancel an order.

Measuring every table against the viewport found the same defect on five more
screens: catalogue (six tables, up to 786px), stock, finance, reports.

All fourteen client screens now measure clean at 390px, and the desks' tables
scroll — verified at 741px of content in a 332px viewport.

### C-4 · Order numbers broke mid-token
`SO-2026-GANESH-01` rendered across four lines on mobile. An order number is one
token and is now `whitespace-nowrap`.

### C-5 · An accessible name with no space in it
The invoice list rendered a party and the word *sale*/*purchase* separated by an
`ml-2` margin. It looked right and **announced wrong**: CSS contributes nothing
to an accessible name, so a screen reader read *"Divyom Sharmapurchase"*.

Only visible by reading the accessibility tree. The separator is now a real
space.

### Clean
The mechanical design detector reports nothing on any changed file. Typography,
spacing, accent usage and material hierarchy were not touched — the incumbent
system is the authority and none of these findings called it into question.

---

## Part 2 — Function

### F-1 · **The tax centre could not reach the return you were filing**
The highest-value finding of the second pass.

The screen correctly defaults to the month the business is in. On 1 September
that is September — which is empty. An accountant opening the tax centre in the
first week of a month is almost always working on the month that just **ended**,
because that is when a return is prepared and filed.

With no period control, the screen was least useful exactly when it was most
needed. Worse, an accountant seeing zeros could not tell an empty month from a
broken page: this tenant's two purchase invoices were simply **invisible** until
the URL was edited by hand.

Every query behind these screens already accepted a window. Only the screens
refused to offer one. Fixed across the tax centre, GSTR-1, GSTR-3B and
exceptions, with the period carried on every link between them.

### F-2 · The low-stock table named a figure its own rule does not use
Headed **On hand** while the reorder rule tests **available**. A board with 100
on hand and 100 reserved is short, and appeared reading "On hand 100" beside
"Reorder at 25" — which looks like a bug in the alert, not a shortage.

Now shows available, and states the on-hand/reserved split when they differ.

### F-3 · A low-stock row had no action
§17 is explicit that a low-stock alert exists so somebody buys more. The row
reported a problem and left the reader to go and find where to solve it. It now
carries **Order more →**.

### F-4 · Adjacent cells disagreed about units
`"0 sheets"` beside a bare `"25"`, both sheets, in the same table. Same class as
C-1 and fixed the same way.

---

## What was checked and found sound

- **Navigation** is exactly the §0 contract: fifteen links, no duplicates, no
  platform vocabulary. The duplicate Audit entry and the two Overviews are gone.
- **The owner lands on `/overview`**, their own business overview.
- **Period boundaries** read the business's month — verified live at 02:33 IST
  on 1 September showing *September 2026* while UTC was still 31 August.
- **The receive form** names its order and shows only that order's lines,
  pre-filled with the outstanding quantity.
- **The reservation refusal** names the godown that holds the stock and what to
  do about it, with no error code on screen.
- **Cancel** works end to end, and the panel names the order it belongs to.
- **The `Processing` order** — previously invisible while consuming ₹82,500 of
  credit — appears in the list with a neutral badge.
- **Per-godown stock tables** link each board to its movement ledger scoped to
  that godown.

## Deliberately not changed

- **Legacy orders still read `Order 462e7714`.** Numbering applies from creation
  onward; back-filling numbers onto historical orders would invent document
  references that never existed on paper.
- **`SO-2026-GANESH-01` keeps its `Processing` state.** Mapped, visible, and
  actionable; rewriting a client's data to match our vocabulary is not ours to
  do.
