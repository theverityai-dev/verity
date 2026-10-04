# Task 59 — Onboarding, notifications and a readable audit (slice 13)

Program: `taskplans/53_plywood_connected_experience.md`.
Specification: §2 (business onboarding), §3 (first client login), §72
(notifications), §78 (audit).

## 1. §3 — do not drop them into an empty Overview

The specification opens this section with an instruction rather than a feature.
A first-time client landing on a dashboard of eight zeroes has been told
nothing: not that the figures are zero because nothing has happened yet, not
what to do about it, and not whether the product is broken.

`onboardingChecklist` returns the eight steps §3 names, in order, and
`SetupChecklist` leads the Overview until they are done — then disappears
entirely. A permanent "you are set up" banner is furniture.

**Each step is checked against real data.** A step is complete when the records
it produces exist, never because somebody ticked it. A checklist with its own
state is a ninth thing to keep in sync with the eight it describes, and the
first time they disagree the checklist is the one that is wrong.

**"Team & roles" counts only roles that hold at least one permission.** An empty
role is not a configured team; counting it would tick a step that leaves
everyone locked out.

**`blockedBy` names the earlier step.** A step that depends on another says
which, rather than being disabled with no explanation — you cannot price a board
before there is a board.

## 2. §72 — a notification says what to do

The specification's contrast is exact:

> Bad: `Low stock.`
> Good: `Century Club Prime fell below reorder level / 7 available · threshold 20 / Create Purchase Order →`

The low-stock sweep already named the board and the figures; it now carries the
action too. And the case that had **no notification at all** now has one: an
order held for credit told nobody, so it sat until the customer rang to ask.
Approvers — resolved as the memberships whose role can act on a sales order —
are notified with the customer, the amount over, and the order to open.

Recipients are de-duplicated: one person can hold several memberships, and being
told the same thing twice teaches people to ignore the channel.

## 3. §78 — an audit a business can read

`state`, `verity.plywood.receive_goods` and `verity.plywood.purchase_order`
answer none of "who did what to which record". `components/ui/business/
vocabulary.ts` maps entity keys, field names and command keys to business words,
and is shared by the audit page and the per-record activity panels.

Shared deliberately: two copies of a vocabulary drift, and the first symptom is
the same event described two ways on two screens — §84's inconsistency appearing
in the log that is supposed to explain it.

**Every lookup falls through to the raw identifier.** A row that cannot be named
is still shown. A change that happened and cannot be described is still a change
that happened, and dropping it would make the log quietly incomplete — the one
property an audit trail must not have. The raw keys stay available in the
context panel, because an operator chasing a support ticket needs the identifier
and a manager reading the log does not.

## 4. §2 — business onboarding

Already built and unchanged: the HQ operator creates a client, activates the
plywood capability and creates the first client administrator under
`(hq)/clients`. §2's closing line — "the operator should not manage the client's
daily business" — is the reason `/people` and `/roles` exist as client screens
in slice 12 rather than the client being sent to HQ.
