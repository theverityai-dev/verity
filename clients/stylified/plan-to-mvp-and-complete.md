# Stylified: the plan from here to client testing, to go-live, and to a complete Verity for him (2026-10-25)

Written for the owner of PlotArmour (the person who decides scope and price). Sources: the client's v2 requirement sheet (23 Oct, 28 requirements),
Ayushmaan Gaur's chat (23 Oct), the proposal pack, the acceptance record, `flow.md`, and the code as of commit `fc6e49dd`. Sizes are my build
estimates, not promises: **S** up to a day, **M** two to three days, **L** four to six.

## 1. Where it stands

The sheet has 28 requirements; FR-020 (dispatch) is out of scope in release one, so 27 count. The honest position on the demonstration workspace,
local only, nothing of this week's work on production yet:

| State | Requirements |
|---|---|
| **Built and tested** | FR-004 fabric inward (duplicate invoice), FR-005 roll stock ledger, FR-006 lots, FR-007 bundles and QR slips, FR-008 bundle split and merge, FR-010 handover with sent and received counts and a challan, FR-012 issue, FR-013 return in four parts, FR-014 wage basis, FR-015 advances, deductions, payments, FR-016 rework, FR-017 costing with shared costs, FR-019 ready garments, FR-021 Excel, CSV, Print / PDF, FR-022 change history, FR-025 acknowledgement method |
| **Built, with a gap** | FR-001 (platform has it; the owner cannot find or run it, section 3 step 1), FR-002 (floor, slips and the munshi's and store's daily screens in Hindi; lots, costs, reports, settings English), FR-003 dashboards (owner and supervisor; no per-role fabric or cost view), FR-011 karigar master (no supervisor link, thin profile), FR-024 alerts (cards only; low-fabric flag; nothing pushed to a phone), FR-026 cases (status derived from approvals, no stored case record), FR-027 intermediary supervisor (the recorder is captured; no custody view, no role), FR-028 routing (order, rename and skip per lot; no optional or predecessor rules) |
| **Not built** | FR-023 hosted restore rehearsal. (FR-009 join or link lots and FR-018 cost re-allocation were built 2026-10-26: `piecework_lot_share`.) |
| **Out of scope by the sheet** | FR-020 dispatch |

Things the sheet implies that nothing in the code does yet: **opening balances** (fabric on the shelf, ready garments, karigar dues and
advances on launch day; the old review called it D-12 and it was never built), and **importing the karigar list** instead of typing it.

Blockers outside the code, in order of how much they hold back:

1. Three migrations are written and applied locally only. The agent is barred from running them on production; you run `npx prisma migrate deploy`, then push.
   `20261023110000_piecework_floor_roles` also still needs confirming on production.
2. Nothing has run on Stylified's hosted workspace: not the storage bucket for photographs, not a supervisor on a real phone.
3. How people sign in on production (email today). Floor supervisors may have no email.
4. The Supabase restore has been rehearsed locally only.

## 2. The line between three finishes

| Finish | Meaning | Test of "done" |
|---|---|---|
| **A. Ready for client testing** | Ayushmaan and the owner can use it on the hosted site with a real supervisor, one real lot, with paper running beside it | Phase 0 and Phase 1 below pass; the 10 acceptance criteria in `acceptance-record.md` met **on the hosted workspace** |
| **B. Go-live** | The factory runs lots on it; paper stops | Phase 2 passes, opening balances loaded, restore rehearsed, 3 lots through all stages without a manual fix |
| **C. Complete for him** | Every "Must" and "Should" in the sheet, then the things a Ludhiana garment maker runs a business on that the sheet leaves out | Phase 3, and a signed scope change for anything beyond release one |

I will not say "MVP ready for client testing" before A is true on the hosted site. Today it is true on the demonstration only.

## 3. Phase 0 and Phase 1: ready for client testing (about 12 to 15 working days)

### Phase 0: make it real on the hosted site (owner steps first, then 2 days)

| # | Step | Who | Size |
|---|---|---|---|
| 0.1 | Run the three migrations on production, confirm `migrate status` clean, then push | **You** | 1 h |
| 0.2 | Create Stylified's workspace on the hosted deployment from the role presets (step 1.3), set the storage bucket | Me, with your keys | S |
| 0.3 | One supervisor, one manager, one photograph flow on that site at 390 px | Me | S |
| 0.4 | Decide sign-in: Supabase email, or a username scheme (section 7, Q1) | **You** | decision |
| 0.5 | Decide `getClaims` (one fewer round trip per page; a revoked session lives up to an hour) | **You** | decision |
| 0.6 | Supabase restore into a scratch project, recorded in the runbook (FR-023) | Me | S |

### Phase 1: the gaps that stop a real owner using it

**Progress 2026-10-25 (local, tested, not on the hosted site):** 1.1 Team screen, 1.2 karigar profile and supervisor link, 1.3 role presets are built
(commit `14cd4c5e`; migration `20261025100000_piecework_karigar_profile`, nullable columns only; tests `capability-piecework-team.test.ts`).
The Team screen groups people by role as cards; a card opens a sheet to change role and stages, set a new password, switch off and on.
A karigar has a profile and a supervisor; a supervisor's give-out list and the issue command follow it.
**Q1 decided (2026-10-25):** one sign-in method, Supabase email and password; a person with no email signs in with a username, which is shorthand for `username@login.verity.local` (`src/lib/login-address.ts`). Unique across Verity, so the Team screen suggests `ravi.stylified`; the owner resets forgotten passwords (nothing is ever emailed to that address). "Last seen" dropped.
**Built 2026-10-25 (later):** ready stock inventory (opening stock, stock out, count corrections, a reversible ledger, migration `20261025200000`), required or optional stages (FR-028, migration `20261025300000`), landing pages by role (the logo and `/` no longer open the platform overview), the acceptance walkthrough as document 6 of the pack. Not built: a stored case table (the derived case carries who recorded and decided; kept), phone alerts (parked by the owner), join or link lots, leave and cover, a roll stock-take, label-printer support, a print queue, an owner summary, packing, Hindi on office screens.
**Also built 2026-10-25 (later still):** leave and cover (migration `20261025500000`), a print queue (`20261025400000`), a roll stock-take (Count the shelf). Packing is a stage added before the first piece is given out (stages are data).
**Built 2026-10-26 (the owner: "finish them too", Hindi scope my decision):** join or link lots with cost re-allocation (migration `20261025600000`, `piecework_lot_share`; all, a percentage, or by pieces; one level; reversible; source records untouched), Hindi on the munshi's and store's daily screens (Fabric, Receive rolls, Count the shelf, Ready stock, Karigars list), **Today** (`/lots/today`, the owner's daily summary on screen), and a Zebra label file (ZPL, checked as text, not yet run on a printer). Still not built: Hindi on lots, costs, reports and settings (decision D-15), a TSC file, phone alerts (parked by the owner), a stored case table (kept derived on purpose).
**1.4 and 1.6 built (2026-10-25):** "Set up the factory" (`/shopfloor/setup`, a journey worked out from what exists) and "Who holds what" (`/shopfloor/custody`, open pieces by supervisor and karigar), both tested and opened at desktop width.
**1.5 opening balances, partly built:** opening fabric stock (a tick on Receive rolls, tagged "Opening stock"), karigar opening balance owed (a payment kind `opening`, counted as wages, reversible), an advance already given (the ordinary Advance), and a pasted-from-Excel karigar list (Import a list). Opening ready garments are built too, as named opening lines in the ready stock ledger (design and size, no lot; decided 2026-10-25, built with ready stock), and "Set up the factory" now lists them as an optional step. The onboarding journey (1.4) is that screen: each step opens the real settings screen, so there is no separate wizard.

Each step ships with database tests and a browser run, in its own commit.

| # | Step | Covers | Size |
|---|---|---|---|
| 1.1 | **Team screen**: people as cards (role, stages, phone, last seen, workload), add a person in one sheet (name, phone, role with a plain line on what it allows, stages, language), switch off and on, reset password, menu entry under Production | FR-001, FR-027 | L |
| 1.2 | **Karigar profile and supervisor link**: photo, join date, address, skills (stages they can do), ID note, emergency contact, in-house or outside; each karigar has a supervisor; a supervisor's Give out list shows only their own karigars (owner and manager see all) | FR-011, FR-027 | L |
| 1.3 | **Role presets** installable once per workspace: Owner, Manager, Supervisor, Munshi, Store, Cutting master, built from permissions (no role name in code), editable on `/roles` | FR-001 | M |
| 1.4 | **Onboarding wizard** for a new workspace: company and challan heading, stages and rates, reasons, limits, roles, people, karigars. Resumable; each step is the real settings screen, not a copy | go-live | M |
| 1.5 | **Opening balances**: fabric rolls on the shelf (reuse Receive rolls with an "opening stock" tag), karigar opening dues and advances (a dated opening entry in the money ledger, reversible), ready garments. Excel paste for karigars and rolls | go-live, D-12 | L |
| 1.6 | **Custody view**: what each supervisor and karigar holds right now, by lot, with age; a handover chain for a bundle (who sent, who checked, who received) | FR-027, FR-010 | M |
| 1.7 | **Stored case record**: status field and owner, so a case survives edits to its approvals; filters by age and holder | FR-026 | M |
| 1.8 | **Alerts that reach people**: overdue lot, long-held bundle, unreconciled quantity, low fabric. Today they are cards; add a daily message (WhatsApp or SMS) only after the provider choice (Q3) | FR-024 | M |
| 1.9 | **Role dashboards**: store view (fabric balance, low stock, rolls), manager view (cost summary, open cases), owner view as built | FR-003 | M |
| 1.10 | **Routing rules**: optional or required flag per stage, predecessor and successor; a lot follows the approved route | FR-028 | M |
| 1.11 | **UAT pack**: the sheet's own acceptance tests turned into a walk-through script with the sample numbers (100 = 94+2+1+2+1; 100 sent, 98 received; 100 issued, 97 returned) and a record sheet the client signs | all | M |

Exit test for Phase 1: the 10 acceptance criteria met on the hosted workspace, the owner adds a supervisor without help, and a supervisor
completes give-out, take-back and scan on a phone at 390 px.

## 4. Phase 2: go-live (about 8 to 10 working days, plus the factory's time)

1. **Pilot week.** One supervisor, two karigars, one real lot, paper running beside it. Every mismatch between paper and system is logged and explained. I fix what it finds.
2. **Parallel run.** All lots in the stages that have been proven; paper kept as the control for two weeks.
3. **Cut over per stage**, not per factory: Pasting first, Finishing last, so a problem stops one stage and not the floor.
4. **Training**: two pages in Hindi per role (what to press, what to do when a count is short), printed; one 45-minute session on the floor.
5. **Hardware**: confirm the phone model and the printer (A4 laser for challans and slips, sticker size for ties) before the pilot, not after (Q4).
6. **Hypercare**: a named person answers within the hour for the first two weeks, then the 4 hours a month in the service terms.
7. Go-live gate: restore rehearsed on the hosted site, three lots through every stage with no manual correction, opening balances signed off by the owner.

Commercial terms (2026-10-25, replacing the 2026-10-22 offer; worked out in `pricing.md`): Option A ₹90,000 + GST once and ₹8,500 + GST a month, or Option B ₹25,000 + GST once and ₹12,000 + GST a month; same scope; one-time invoiced 50% at kickoff and 50% at go-live; three-month initial term from go-live.

## 5. Phase 3: a complete Verity for him

Two groups. Group A is in the sheet and closes release one. Group B is not in the sheet, comes from what the chat and the trade need, and each item is a
**scope change** priced separately, never folded into the monthly fee.

### Group A: finish the sheet (about 8 to 10 working days)

| # | Item | Covers | Size |
|---|---|---|---|
| 3.1 | **Join or link lots**, with cost moved by pieces or a percentage; sources never edited. **Built 2026-10-26** | FR-009, FR-018 | L |
| 3.2 | **Hindi on office screens**. Munshi and store screens **built 2026-10-26**; lots, costs, reports and settings remain (confirm in UAT) | FR-002 | L |
| 3.3 | **Packing step** if the owner confirms it (FR-019 says only if confirmed) | FR-019 | M |
| 3.4 | **Leave and cover**: mark a supervisor away; another takes their stages and karigars for the days | FR-027 | M |
| 3.5 | **Print queue**: remembers which slips were printed, flags a bundle with no slip, reprints in bundle order | usability | S |
| 3.6 | **Stock-take mode**: scan every roll on the shelf, show the difference against the ledger, post it as an adjustment with a reason | FR-005 | M |
| 3.7 | **Label printer language**. Zebra (ZPL) file **built 2026-10-26**, not yet run on a printer; TSC remains | FR-007 | M |
| 3.8 | **Daily owner summary**. **Today** screen built 2026-10-26; by message is parked with 3.9 | FR-003, FR-024 | S |
| 3.9 | **WhatsApp or SMS of a karigar's challan and wage slip** (the worker has no app; this is the nearest thing to one) | FR-025 | M |

### Group B: beyond the sheet, in the order a garment maker needs them

| # | Item | Why | Needs |
|---|---|---|---|
| 4.1 | **Dispatch** (lot, packet, quantity, party, transport reference) | FR-020 is out of scope now; the natural next step once ready stock is trusted | scope change |
| 4.2 | **Style and size master**, orders per buyer, lot from an order | The client said no size tracking; revisit when buyers ask | the client to ask |
| 4.3 | **Supplier and party master** with ledger (fabric suppliers, outside units, job-work parties) | Today a roll has a free-text supplier | scope change |
| 4.4 | **Tally export** of wages, advances, fabric purchases (voucher file) | Most Ludhiana makers keep books in Tally | accountant's format |
| 4.5 | **Job-work challan in GST format** for outside units | ASK 6 in the chat; check with their accountant before building | Q5 |
| 4.6 | **Offline scanning** for a floor with weak signal: queue and sync | D-11 says online-first; build only if the pilot shows drops | pilot result |
| 4.7 | **Multi-unit** (a second factory, an outside unit as a tenant of its own) | The proposal says one unit | scope change |

Not building, because nothing says they are wanted: payroll with attendance, shift rosters, AI features on the floor, a customer-facing portal.

## 6. How the work is kept honest

- Each step lands as a commit with tests, and the requirement table in `flow.md` and the work list in `FINISHER.md` move in the same commit.
- "Built" means in the repository and tested. "Demo-ready" means walked at 390 px and desktop, light and dark. "Client-ready" means run on the hosted site. I will use the three words separately.
- The other work stream in this repository (the assistant) shares the index; I commit with a pathspec and never rewrite history.
- Anything that adds a security boundary, a new platform primitive, or a client fork stops for an ADR first (Verity's own rule). None of the above does, except Q1 if it means a new sign-in method.

## 7. Questions that block, and my default if you do not answer

| # | Question | My default |
|---|---|---|
| Q1 | How do supervisors sign in on production: email, or a username and password you hand out? | Email-shaped usernames (`ravi@stylified.local`), same Supabase login, no new method |
| Q2 | Does Stylified want Hindi on office screens (FR-002 reads "all core screens")? | Floor, slips, munshi and store screens Hindi now; lots, costs, reports, settings English; ask in UAT |
| Q3 | WhatsApp or SMS for alerts and challans, and who pays the provider? | Build the outbox only (already in the platform); no provider until you choose |
| Q4 | Phone models, printer model, sticker size on the floor? | A4 and a 6.4 cm sticker sheet; camera scanning |
| Q5 | Does their accountant need a GST job-work challan for outside units? | Internal challan as built; GST format after the accountant answers |
| Q6 | Is packing a separate step before ready stock? | Not built |
| Q7 | Who is the single contact at Stylified for UAT and sign-off (Ayushmaan, or the owner)? | Ayushmaan for the floor, the owner for money rules |

The 14 decisions D-01 to D-14 in the old review are already decided from the sheet's suggested defaults, kept configurable, and go to the client for confirmation in UAT, not before.

## 8. Risks, plainly

1. **The floor is the risk, not the code.** A supervisor who scans only when watched gives a ledger that is wrong in a believable way. The pilot week and the paper control exist for this.
2. **Scope creep through the sheet.** v2 grew from 24 to 28 requirements in two days and the chat adds more. Group B must not enter the monthly fee. Every addition gets a line in this file and a yes from you.
3. **One production blocker sits with you** (migrations). Every day it waits, the hosted site shows none of the work.
4. **Single builder.** If I am unavailable, the repository, `flow.md`, the acceptance record and this plan are the handover.
5. **Real data is unproven.** The year-of-history speed test used generated data; the first real month may show a slow screen. Phase 2 includes a measurement.
6. **The client may reopen a settled decision** (stages, rate precedence, lost-piece charge). They are data, so changing one is configuration, but each change is logged here.
