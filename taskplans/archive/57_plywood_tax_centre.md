# Task 57 — The accountant's tax centre (connected-experience slice 11)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §5 (tax settings), §29–30 (match and posting), §58 (tax centre),
§59 (ITC reconciliation), §61 (GSTR-1), §62 (GSTR-3B), §63 (exceptions), §75
(the accountant's day).

## 1. The defect this slice exists for

`raisePurchaseInvoice` stored every purchase invoice with
`taxablePaise = totalPaise` and **every tax column at zero**. The reasoning in
the code was that the split is the supplier's and not ours to compute. That
reasoning is correct. The conclusion drawn from it was not.

The consequence was that **input credit was structurally always nil**:

- `taxSummary.inputTaxPaise` summed those zeros, so eligible ITC was ₹0 no
  matter what the business had actually been charged.
- Every purchase invoice raised a `no_input_credit` exception, so the exception
  list was noise and told an accountant nothing.
- The net GST estimate overstated what was payable **by the entire input side**.

A business filing from that number pays its tax twice. This is the largest
single money error found anywhere in the plywood capability.

The fix is not to compute the split. It is to **record** it. The command now
takes `taxablePaise`, `cgstPaise`, `sgstPaise`, `igstPaise` and the supplier's
own invoice number, transcribed from their document, and validates only:

1. the parts sum to the stated total, and
2. IGST does not appear alongside CGST/SGST.

Both of those are transcription errors, and both belong on an exceptions list
rather than in a return. The fields are optional, so an invoice can still be
recorded before its split has been read off — that case now surfaces as an
exception instead of silently costing the business its credit.

The command also writes invoice **lines** from the received quantities, so the
purchase register has an HSN summary to file from (§60). Received, not ordered:
the invoice is for goods that arrived, and §29 wants the difference shown rather
than hidden inside a line.

## 2. Delivered

| Route | Section |
|---|---|
| `/tax` | §58 — output, credit, net, exceptions; every figure derived |
| `/tax/gstr-1` | §61 — B2B, B2C, HSN summary |
| `/tax/gstr-3b` | §62 — output liability, input credit, cash required |
| `/tax/exceptions` | §63 — grouped by kind, each with the action that clears it |
| `/settings/tax` | §5 — registration and effective-dated rates |

New queries: `gstr3bWorking`, `taxSettings`.

Navigation: **Tax & Compliance** now lands on `/tax` rather than on `/tax/close`
— closing a period is a month-end task, reading the position is a daily one.
Tax Settings and Audit added under Administration.

## 3. No field, anywhere, on a return

§58 says the tax centre must never become a second entry system, and these
screens have no input on them at all. A person who can type into a GSTR-3B has
produced a return that no longer agrees with the invoices behind it and no way
to say which is right. Each figure is shown with the count of documents that
compose it, and the screen drills into those documents instead.

## 4. Books ITC and eligible ITC are two fields on purpose

They are equal today. They are still separate, because the moment a GSTR-2B
import exists, "eligible" becomes *matched with the portal* and only that line
changes meaning. One merged number would have to be split at that point with
every reader of it re-checked.

An invoice with no tax split is reported as **unsubstantiated**, not
disallowed — the credit is not refused, it is unproven.

## 5. Escalated, not improvised: §59 ITC reconciliation

§59 asks for a reconciliation against GST portal records (GSTR-2B), bucketed as
matched / missing in GST / missing in Verity / amount mismatch / GSTIN mismatch.

**There is no import path for portal data, and none was invented.** Every bucket
in §59 is a comparison between two datasets and this system holds only one of
them. Building the screen against a dataset that does not exist would produce a
reconciliation that always reports "missing in GST" for every invoice — worse
than no screen, because it would look like a finding.

Classification: **missing specification** — the specification does not say how
GSTR-2B reaches the system (upload, API, or manual entry), and that choice is a
product decision with security consequences (portal credentials, or file upload
of a document containing every supplier's GSTIN). It needs a decision before it
is built.

What is delivered instead is the half that is real: the purchase register with
its tax split, the unsubstantiated-credit count, and an exceptions list naming
each invoice that cannot yet evidence its credit. When the import lands, only
`eligibleItcPaise` changes.

## 6. Fixed on the way

**Conformance regression, mine.** `conformance.test.ts` checks that a command
declares `verb` and `entity` within 900 characters of `CommandDefinition<`. The
long note on the ITC defect, written inside the generic type parameters, pushed
`verb:` past that window. Moved above the declaration, which is where a note
about the command belonged anyway.

**A permanently-red test that had nothing to do with the code.**
`authorization-layers.test.ts` tore down by deleting its tenant, then its
capability. A previous run that died between those two steps left an activation
behind, and every subsequent run then failed on the foreign key — for ever, on
any database the suite does not exclusively own. The teardown now deletes every
tenant activating the test's own capability, which is self-healing because that
capability id is unique to the file. The stale row was cleared from the hosted
database after confirming it held zero business rows.
