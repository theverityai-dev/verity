# Task Plan 51 — Tax (Slice 6)

**Program:** `45_plywood_workflow_program.md`. **Slice 6 of 7.**
**Closes:** audit **P0-07**. Delivers specification §5, §50, §58, §61, §63.

---

## 1. The rate becomes a dated rule

Rates lived in three global configuration keys for the whole business. Two
things were wrong with that and they are the same shape:

*   a plywood sheet and a hardware fitting do not carry the same rate;
*   a rate changed by notification in November must not restate an invoice
    raised in October.

`PlywoodTaxRule` — keyed by **registration** and **HSN**, effective-dated, with
the notification recorded because an auditor asks.

**Most specific first.** An 8-digit rule beats the 6-digit rule for its family,
which beats the 4-digit rule for its chapter. That is how the tariff itself is
written; a lookup that ignored it would apply a chapter default to a board with
its own notified rate.

**Superseding, not overwriting.** Setting a new rate closes the old row with an
`effectiveTo` and opens a new one. The old rate stays in force for invoices
raised under it — the entire reason these rows are dated — and a partial unique
index allows exactly one open rule per HSN per registration, because two
overlapping rules mean the tax depends on which row the query read first.

**One rate is entered, not three.** 18% is 18% whether collected as 9+9 within
the state or as 18 across a border. Asking for three numbers invites two of them
to disagree; IGST is derived from the two halves so they cannot drift.

---

## 2. A missing rate refuses

Rule freeze §4.4, and the most important line in the slice.

A missing rate used to produce a **zero-tax invoice**, which is
indistinguishable on screen from a genuinely exempt supply and is discovered
when the return is filed. `resolveTaxRate` now throws, and the message says what
to do.

The three configuration keys remain as a fallback **only** for a tenant that has
set no rules at all. A business that has completed tax setup never reads them.

---

## 3. A mixed-rate invoice is refused, not silently mis-taxed

The invoice model carries one set of rates. An order whose lines resolve to
different rates now raises `E_VALIDATION` telling the user to split it.

The alternative was to tax the whole invoice at the first line's rate, which is
wrong in a way nobody sees until a return is questioned. Line-level tax is a
schema change and its own task; refusing is the honest interim.

---

## 4. Tax is derived, never re-keyed

`taxSummary` and `gstr1Working` read posted documents and nothing else. There is
deliberately **no command** that lets somebody type a figure into a return,
because the moment one exists the return and the invoices stop agreeing and
nobody can say which is right. The specification says it outright: *the tax
centre should never become a second entry system*.

`taxSummary` nets credit notes off output tax and **shows them separately**
rather than silently absorbing them. Exceptions (§63) are named as work a person
has to do, with the document each is on: missing place of supply, missing HSN,
zero tax to confirm as exempt, and a supplier invoice with no tax split — which
is honestly reported as *no input credit claimable*, not counted as zero.

`gstr1Working` splits B2B from B2C on the buyer's GSTIN, summarises by HSN, and
checks invoice-sequence continuity, which is what a GST officer looks at first.
The HSN tax figure is **apportioned by line value** and the comment says so:
exact at invoice level, apportioned within it, because tax is stored on the
invoice rather than the line.

---

## 5. Files

```text
prisma/migrations/20260831170000_plywood_tax_rules/   rules, constraints, RLS
src/server/capabilities/plywood/tax.ts                NEW — resolveTaxRate, setTaxRule, taxSummary, gstr1Working
src/server/capabilities/plywood/finance.ts            invoices resolve rates per HSN per day
src/app/(shell)/settings/business/                    tax rates panel
src/test/plywood-tax.test.ts                          NEW, 10 tests
```

---

## 6. Evidence

```text
Tests  772 passed | 4 skipped (776)
```

Suite 766 → 776. `tsc --noEmit` clean. Includes both halves of §50 — CGST+SGST
within the state, IGST across a border, at the same total rate.

---

## 7. Still open

*   **Purchase invoice tax lines.** A supplier invoice still records one total
    with no split, so expected ITC cannot be computed from it. `taxSummary`
    reports each one as an exception rather than pretending the credit is zero.
    Capturing the supplier's own split is the next task in this area.
*   **GSTR-3B working** and portal reconciliation (§59, §62). GSTR-1 is the one
    generated entirely from documents this system owns; 3B needs the ITC split
    above, and reconciliation needs an import.
*   **Line-level tax**, for mixed-rate invoices. Refused rather than
    mis-computed today.
*   **Reverse charge, exempt and nil-rated supplies, and cess.** Not modelled;
    a zero rate is currently a rate of zero rather than a distinct treatment.
