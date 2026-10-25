# Stylified: the flow, cut down to what they asked for (2026-10-24)

Source: Ayushmaan Gaur's chat, the owner's four answers, and a long brief written from them. This page keeps only what a garment maker
actually does each day. Everything dropped is listed, with the reason, so it can be put back by choice.

## The flow (seven steps, bundle-level)

1. **Receive rolls.** Each roll gets a number and a printed QR label: fabric type, quantity.
2. **Make a lot.** A design, a planned quantity, and a **rate card** (what each stage pays per piece).
3. **Cut.** Pick the rolls, say how much fabric went into the lot and how many pieces came out. The system makes the numbered **bundles**, each with a QR.
4. **Give out.** Scan a bundle, pick the worker, confirm the count. A **printed challan** comes out (the worker has no phone).
5. **Take back.** Scan the bundle, count what returned: good, rejected, rework, short. The **receiver's count is the truth**. A shortage opens a **case** on the worker who held the pieces and sends a **charge request** for the lost pieces.
6. **Next stage.** Good pieces flow to the next stage in the order Stylified sets. The last stage's good pieces are **ready garments**.
7. **Pay.** Wages come from the lot's rate card times accepted pieces. Advances, payments and the balance live on each worker.

The system ends at ready garments. Dispatch is not in it.

## What the chat settled

- Stages stay as they are (and stay editable). The supervisor covers workers without phones: allots work, marks it done, scans the quantities out.
- A discrepancy belongs to the worker who held the pieces; the supervisor above answers for how it is resolved. **Lost pieces are charged to the worker.**
- Everything is configurable.

## What is configurable, and where

| Setting | Where | Default |
|---|---|---|
| Stages: name, order, default rate per piece, active | Settings, Stages | the five existing stages |
| Rate per piece, per lot and stage | the lot's Rate card | the stage's default rate |
| A worker's own rate and wage basis | Karigar page | none (the lot or stage rate applies) |
| Which rate wins | fixed, shown on screen: lot rate, then the worker's own, then the stage default | n/a |
| Charge for a lost piece (a lot can override it) | Settings, Charges | none, so no charge is raised |
| Reasons for rejected, rework and short (English and Hindi) | Settings, Reasons | stitch, measurement, stain, hole, other |
| Fabric types and unit (metres or kilograms) | typed when a roll is received; the list builds itself | none |
| What a manager can approve alone | Settings, Limits | ₹1,000 and 5 pieces |
| Who looks after which stage | Settings, Team | the owner assigns |
| Challan heading and address | Settings, Challan | the company name |
| Language of the floor screens | each phone | English |

## What I cut from the brief, and why

| Cut | Why |
|---|---|
| Scanning every garment | The chat is about bundles and rolls. A bundle count is enough; a single garment tag can be added later |
| Signature, PIN or login for each worker's acknowledgement | The worker has no phone. The supervisor confirms the count and the paper challan carries the worker's signature |
| Splitting and merging bundles | Not asked for. The model keeps the parent link so it can come later |
| Material cost, cutting waste rules, other cost categories | Costing here is wages plus lost-piece charges. Fabric used per piece is shown as a plain figure |
| A case workflow with investigators and assignments | A case has four states: open, charged to the worker, written off, found. Who decides is the manager or owner |
| Eight roles | Owner, Manager (also the store view), Supervisor, Munshi. Roles are data, so a Store role is one screen away |
| A separate QC module | QC is a stage whose take-back is accepted, rejected, rework. Reasons carry the defect |
| Supplier master, inward costing | A roll has a free-text supplier and a date; nothing more |
| Workflow diagrams and a document set before coding | The working screens are the demonstration |

## The screens

| Screen | The user's job | Shape |
|---|---|---|
| **Scan** | Open a roll or bundle with the phone camera, then act | A viewfinder, then one card for what was scanned with its next action |
| **Fabric** | See roll stock and receive rolls | Roll cards with a balance ring; a sheet to receive many rolls and print labels |
| **Lot** | Plan, cut, price and watch one lot | A journey (rolls, cut, stages, ready), the rate card, the bundles |
| **Give out and Take back** | Move a bundle one step | A bundle card, big counters, the challan |
| **Cases** | Settle what went short | A ledger by age: who held it, how many, what was done |
| **Ready garments** | See what is finished, by lot | Lot cards with counts and pictures |
| **My karigars** | Allot work to people without phones | People cards: holding now, due, quality rate |
| **Karigar account** | Pay | Earned, advance, deductions, paid, balance |
| **Settings** | Change how the factory works | One page with a section per setting above |

## Built (2026-10-24, local demo only, not on production)

| Screen | Route | State |
|---|---|---|
| Production settings (stages, default rates, lost-piece charge, reasons in two languages, challan heading, manager limits) | `/lots/settings` | built, walked locally |
| Fabric: stock per fabric, roll cards, receive many rolls, roll page with movements | `/fabric`, `/fabric/[id]` | built, walked locally |
| Roll labels with QR | `/fabric/labels` | built |
| Lot: rate card (rate per stage, lost-piece charge, skip a stage), fabric used, one-step cut with slips | `/lots/[id]`, `/lots/[id]/slips` | built, walked locally |
| Give out with the karigar's count, confirmation method, shared challan | `/shopfloor/give-out` | built; server proven by tests, screen not yet walked |
| Take back with the factory's own reasons | `/shopfloor/take-back` | built; server proven by tests, screen not yet walked |
| Challan to print | `/shopfloor/challan/[number]` | built, walked locally |
| Cases | `/shopfloor/cases` | built, walked locally |
| Ready garments | `/lots/ready` | built |
| Scan: camera (browser detector on Android, a small decoder on iPhone), a hand scanner, or a typed number opens a bundle, roll, lot or challan; a bundle shows only the moves open to this person now | `/shopfloor/scan` (first floor tab) | built |
| What you can do now, on the bundle page a phone's camera opens from a slip | `/lots/bundles/[id]` | built |
| Lot cost: fabric at roll rates + wages + other costs by the factory's own categories - charges recovered; cost per good piece; a shared bill split by pieces cut, shown before saving; reversal, never edit | lot page, `/lots/reports` | built, tested |
| Ready stock: what production made ready, opening stock, stock out (sold, dispatched, sample), count corrections with a reason, a reversible ledger, Excel | `/lots/ready` | built, tested |
| Required or optional stages: a lot can skip only an optional one | Production settings, lot rate card | built, tested |
| Cost categories in two languages, edited with the other lists | `/lots/settings` | built |
| Split and join bundles at the cutting table (refused once any of it is given out, because its pieces already move in parts) | bundle page | built, tested |

Every popup in the piece-rate screens now uses one sheet (`FormModal`): Cancel then the primary action in the footer, the refusal at the
foot of the form, a pending label on the submit. Text glyphs used as icons were replaced by the drawn icon set.

Decided 2026-10-25 (owner: "you decide"), stated to the client as decision D-15 in document 2: Hindi stays on the floor screens, daily entry and slips; the office screens stay English in this release and a Hindi office interface is the first quoted next step. Decided, not built: the office screens (lots, fabric, costs, settings) stay in English. The chat asks for Hindi where karigars and
supervisors work, and the floor screens and the daily entry have it; the owner, manager and munshi screens are read in English today.
A language toggle on them is a contained follow-up if Stylified asks.

MVP completion pass (same day):

| Gap in the client's v2 sheet | Now |
|---|---|
| FR-021 Excel and PDF export | Every report has Excel (a real .xlsx, written without a library, text never evaluated as a formula), CSV, and Print / PDF (the browser's own Save as PDF) |
| FR-004 duplicate invoice | The same supplier's invoice number is refused unless the person confirms a second delivery (screen warns first; server enforces) |
| FR-024 low fabric stock | One level in Settings; Fabric flags every fabric under it, including ones with nothing left |
| FR-017 double counting | A cost named like fabric, wages or any stage is refused, because those are already counted from the records |
| FR-022 audit | **Change history** (owner and manager): who did what, when, newest first, filtered by kind, each line opens its record |
| FR-026 and FR-027 cases | A case shows who recorded it (the supervisor in the middle) and, once settled, who decided, when and what they wrote |

Usability pass (2026-10-25, from the owner's review):

| Complaint | Now |
|---|---|
| "Showing 1 to 5 of 5 records" cut off, spacing off in cards | A table inside an edge-to-edge card keeps its filter box, footer and phone rows inside the card's gutter (fixed once in `DataTable`/`Panel`, so all 135 uses) |
| Calendar did not show in New lot | Date, date-time and searchable pickers open in the browser's top layer, above a sheet |
| Search ignored the client's records | Ctrl K finds a bundle, lot, roll, karigar or challan by number (`b4`, `B-0004`), name, phone, supplier or invoice; empty search offers Scan, Lots, Karigars, Fabric, Cases, Reports |
| Bulk printing | Slips: choose which, only those not yet given out, full or sticker size (remembered); the day's challans printed together; all shelf roll labels in one go |
| Reports and stage tables | Graphics first (tiles, stage bars, lot cards, loss bars, money bars), every table folded below with Excel, CSV and Print / PDF |

Ideas not built yet, in the order I would do them: a "print queue" that remembers which slips were printed and flags a bundle with no slip
printed; a pick list per supervisor for the day; WhatsApp or SMS of a karigar's challan and wage slip; a stock-take mode for rolls by scanning;
barcode printer (Zebra / TSC) language instead of A4; a daily owner summary by message.

Still not built: joining or linking whole lots, and re-allocating cost when lots are split or joined (FR-009 and FR-018, priority Should);
a stored case record with its own status field (the status is derived from the approvals); a separate role for an intermediary supervisor
beyond the person who records the handover; Hindi on the office screens (decided); the Supabase restore rehearsal (FR-023).

## Team management: what is there and what is missing (2026-10-25, from the owner's question "why no team management")

**Already in the platform, but not reachable from Stylified's menu.** `/people` (create a login with a password, pick a role, change a
role), `/roles` (create a role, tick what it may do) and `/shopfloor/team` (stage per person, manager limits). Only the plywood and trading
capabilities link to People and Roles; piece-rate links only "Team and limits". So the owner of a Stylified workspace has no way to find
the screen that adds a supervisor. The four roles (Owner, Manager, Supervisor, Munshi) exist only because the demo seed creates them;
a fresh workspace starts with none.

**What an owner needs, in the order they do it**

| # | Need | Today |
|---|---|---|
| 1 | One **Team** screen in the piece-rate menu: people as cards (role, stages, phone, last seen), a filter by role | People page is a plain list with a role dropdown |
| 2 | **Add a person in one sheet**: name, phone, role (from a short list with a plain line on what each can do), the stages they look after, language, a temporary password | Login sheet asks email + password + "works at" (one organisation, meaningless here); stages are set on another page afterwards |
| 3 | **Role presets** for a garment maker: Owner, Manager, Supervisor, Munshi, plus Store and Cutting master, made once from permissions and editable | Only in the seed; `/roles` is a raw permission matrix |
| 4 | **Sign-in that fits the floor**: phone number or username, not only email; reset a forgotten password; force a new one at first sign-in | Email only; reset action exists (`resetTeamPassword`) with no button; none under the Keycloak demo provider |
| 5 | **Switch someone off, switch back on** (a supervisor leaves; the history stays) | Commands exist (`disable_membership`, `restore_membership`), no button on the People page |
| 6 | **Who looks after which karigars**: each karigar has a supervisor; a supervisor's give-out list shows only theirs | No link between a karigar and a supervisor at all |
| 7 | **Karigar profile**: photo, mobile, address, join date, skills (stages they can do), wage basis, ID note, emergency contact, in-house or outside | name, mobile, kind, address, active only; the stage default rate is the only trace of skill |
| 8 | **Supervisor profile and workload**: stages, karigars, bundles open now, late, day closes, charge requests raised | Day-close list on Team and limits; nothing per person |
| 9 | **Leave and cover**: mark a supervisor away; another takes their stages for the days | Not built |
| 10 | Who did what | Change history already shows the actor |

**Built 2026-10-25 (local, tested, walked at desktop and 390 px):** needs 1, 2, 3, 5 and part of 7 and 8: the Team screen (`/shopfloor/team`), add a person in one sheet, six installable role presets, 
switch off and on, owner-set passwords, a karigar profile (joined, ID note, emergency contact) and a supervisor per karigar that the give-out list and the issue command follow, 
username sign-in for people with no email (Q1), opening balances (fabric tick, karigar balance owed) and a pasted karigar list. Still open: 6 custody view, 8 workload beyond pieces held, 9 leave and cover.

Decisions taken (to build): fold 1, 2, 3, 5 and 8 into one Team screen under Production; add `supervisorId` (a user) to the karigar and the
karigar profile fields in 7 as a migration of nullable columns; seed the six presets as a pack-style role set a workspace can install once;
sign-in by phone or username follows the identity provider that production uses and needs the owner to say which (Supabase email today),
so it stays a question until then. Not building: payroll, attendance by clock-in, shift rosters (not asked, and a Ludhiana floor pays by the piece).

Production: the migrations `20261024100000_piecework_flow`, `20261024200000_piecework_lot_costs`, `20261024300000_piecework_low_fabric` and `20261025100000_piecework_karigar_profile` were applied by the owner on 2026-10-25 (`npx prisma migrate deploy`). All four only add tables and nullable columns. The code reaches the hosted site when the owner pushes.
