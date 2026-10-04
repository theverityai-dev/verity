# Task 64 — Input credit reconciliation (slice 18)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: target user flow §59, and §62's eligible-versus-books distinction.

## 1. Why this was escalated first, and what changed

Task 57 recorded §59 as **missing specification** and refused to build it. That
was right at the time: every bucket §59 names — matched, missing in GST, missing
in Verity, amount mismatch, GSTIN mismatch — is a statement about rows that are
not ours, and the system held one dataset. A screen built against absent data
would have reported the entire purchase register as "missing in GST" and looked
like a finding rather than an empty comparison.

What was missing was not the screen. It was a decision about how portal data
arrives. That decision is made here and recorded, which is what an
implementation decision requires.

## 2. The decision: explicit import, never stored credentials

**Portal data arrives by importing parsed rows.** Not by holding a client's GST
portal login and fetching.

- Storing portal credentials would make this system a target for something far
  worse than its own data — those credentials reach the client's entire tax
  filing, not their plywood stock.
- §59 asks for a *comparison*. It never asks for automation, and inventing an
  integration to satisfy a requirement that did not ask for one is scope taken
  rather than given.
- An import is repeatable and auditable. A scrape is neither.

**Nothing is kept beyond what the comparison needs.** No credentials, no
session, no uploaded file. The CSV is parsed in the browser and only the fields
that participate in matching are stored.

Classification: **implementation decision**, made and recorded here rather than
promoted into a constitutional rule. A managed portal integration remains
possible later; it would change how rows arrive and nothing else.

## 3. The rule that shapes the table: portal data is never posted from

`plywood_gst_portal_record` is not a ledger. No payable, ledger entry or credit
derives from a row in it.

What the business owes is what its suppliers billed it. The portal is a **second
opinion used to find disagreements**. Treating it as a source of truth would let
an imported file rewrite this business's books, which is the failure mode a
reconciliation feature is most likely to introduce.

## 4. Matching, and the case that must not be mislabelled

Matched on **supplier GSTIN + the supplier's invoice number**, because that is
the pair the portal keys on. Our own invoice number is a different number in our
own series; matching on it would match nothing and report the whole register as
missing.

A purchase invoice recorded **without** the supplier's number, or against a
supplier with no GSTIN, cannot be matched at all. That is reported as its own
condition — "cannot be matched" — and deliberately not folded into "missing in
GST", which would accuse the supplier of failing to file when the gap is on this
side.

GSTIN mismatch is checked **before** "missing in Verity" is trusted: the same
invoice number filed under a different GSTIN is one invoice recorded wrongly,
not one invoice absent and another unexpected.

## 5. Import replaces a period rather than appending

The portal amends a period after the fact. An import that added rows would leave
a superseded version beside the current one, matching twice and reporting
differences that no longer exist. Replacing the period makes re-importing safe,
which matters because an accountant re-imports whenever the portal changes.

Scoped to one period per call, so a partial file cannot silently empty a period
it never mentioned. Every row is validated **before** anything is deleted: a
file whose figures do not add up must not be able to empty a period it then
fails to refill.

## 6. Database constraints that keep bad data out of a return

The table carries the same checks a purchase invoice does — parts sum to the
total, IGST never alongside CGST/SGST, a well-formed GSTIN. A malformed portal
row is not a reconciliation finding, it is a bad import, and it must not reach
the comparison and be reported as a supplier's error.

RLS is enabled and forced, as on every other tenant table. A supplier GSTIN is
commercially sensitive and is protected exactly as the rest of the tenant's data
is.

## 7. What §62 gains

`gstr3bWorking` returns `booksItcPaise` and `eligibleItcPaise` as separate
fields, and Task 57 said why: "the moment a GSTR-2B import exists, eligible
becomes *matched with the portal* and only this line changes". That moment is
now. The reconciliation reports `matchedTaxPaise`, which is the figure eligible
credit should follow once a business is reconciling regularly.

Deliberately **not** wired automatically in this slice: making eligible ITC
depend on an imported file means a period with no import silently reports zero
eligible credit. That is a bigger change than it looks and belongs behind an
explicit decision about what an un-imported period should claim.
