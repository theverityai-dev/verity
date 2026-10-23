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
