# Stylified: the scan-in, scan-out workflow (from Ayushmaan Gaur's chat, 2026-10-23, 7:50 pm)

This is a reading of a WhatsApp chat in Hinglish, not a signed requirement. Items marked **ASK** are not clear from the chat and must
be confirmed with Ayushmaan before anything is built.

## What the chat says

1. **Fabric rolls carry a barcode.** Scan a roll, get which fabric it is; enter how much was used and from which lot.
2. **Bundles carry a barcode too.** Once cut into bundles, a bundle moves forward by scanning. A worker's whole job is **scan in, scan out**.
3. **The money works itself out.** A bundle of 100 pieces on lot 108, where the rate is ₹45 a piece, posts ₹4,500 to the account by itself.
4. **The departments**: fabric (cutting), master (bundling), tailor (scan in and out), overlock, store (scan in), and **QC as a separate department**.
   The **supervisor** only checks where bundles are going and checks quantities.
5. **A department that finishes work produces a hard-copy challan**, because the tailor has no app.
6. **Both sides must scan.** The supervisor scans on their own ID and checks that what arrived matches what was sent. The **next department checks the
   previous department's work, and the receiver's word is the one that counts.** One-sided scanning "will not work".
7. **If pieces go missing** it is looked into later. If the person who scanned out and the person who scanned in do not match, that is a mismatch to be
   resolved. Work keeps moving, but someone must answer.
8. **The supervisor is the responsible person.** Supervisors are not inside a department; they sit **between** departments (between the tailor and the master,
   for example), so each handover has exactly one owner. Example: person X handed 10 to lot A, 4 to lot B, 3 to lot C and then checks them back; X is
   answerable for that stretch.
9. **At the store, a shortage needs a reason** (a defect, for instance), and **the costing is updated** to match.
10. **The store manager is the centre** of it all.

## What we already have, and what is new

| The chat wants | We have today | Gap |
|---|---|---|
| Bundle with its own number and barcode | Numbered bundles (B-0001...), printed slip with a **QR** that opens the bundle | Scanning a QR to *move* a bundle (today the QR only opens a page). Slip is not a challan |
| Scan in, scan out | Issue and take-back are typed by the munshi or a supervisor, per bundle, with a four-way count (good, rejected, rework, short) | A scan flow on a phone; workers have no login (karigars are records, not users), so the supervisor or store scans for them |
| Both sides confirm; receiver's count wins | A take-back reconciles one issue; "accounted for 96 of 98" | **A handover between two stages that the receiver confirms**, with a mismatch recorded when the receiving count differs, and the receiver's count taken as the truth |
| One responsible person per handover | Supervisors are scoped to stages | **Ownership of the gap between two stages**, and a "custody" view: what each responsible person holds right now, by lot |
| Money by lot rate (lot 108 at ₹45) | Rate is per karigar and per stage, wage basis issued, good or returned | **A rate per lot (and stage)**, taken first, so 100 pieces at ₹45 posts ₹4,500 without anyone choosing a karigar rate |
| Hard-copy challan when a department finishes | Printable bundle slip | A **challan** per handover: from, to, bundles, counts, a barcode, a signature line |
| Fabric roll barcodes, fabric type, metres per lot | Nothing (Phase 2 in the proposal: fabric inward and the metre ledger) | **Rolls**: a barcode, fabric type, metres in, metres used per lot |
| Departments: fabric, master, tailor, overlock, store, QC | Stages: Pasting, Collar and Cuff, Stitching, Button and Kaj, Finishing (from the earlier requirement workbook) | **The stage list is different.** See ASK 1 |
| Store shortage with a reason, costing updated | Short pieces are recorded with no reason code; costing is wages only | A reason on each short or rejected piece, and a cost that absorbs it (Phase 2 costing) |
| Store manager as the hub | No store role | A store role and screens: scan in finished bundles, see shortages, reasons |

## Things the chat settles

- Both-sided confirmation replaces our one-sided take-back for **handovers between stages**; we keep take-back for work given to a karigar or an outside unit.
- A mismatch is **not a blocker**: work continues and the responsible person is asked to explain. So it needs an open "discrepancy" with an owner, an age
  and a resolution, not a refusal. (This fits how the shortage register already behaves.)
- Responsibility is a person at a handover point, not a department.

## ASK: before building

1. **Stages.** Is the flow now fabric (cutting), master (bundling), tailor, overlock, store, with QC separate, instead of Pasting, Collar and Cuff, Stitching,
   Kaj, Finishing? Or are those inside "tailor"? Where do button and kaj, collar and cuff, pressing and packing happen?
2. **Who holds a phone or scanner?** Tailors have no app (so a supervisor scans for them?). Do the master, the overlock operator and the store each scan
   themselves, or does only the supervisor scan?
3. **Rate per lot.** Is the ₹45 for the whole garment on lot 108, or per stage (tailor ₹45, overlock ₹8...)? Does every worker on a lot get the same rate?
4. **Receiver's word prevails.** If the tailor says 98 and the master sent 100, the lot moves with 98 and 2 are "short" in the master-to-tailor handover,
   with the supervisor of that handover answerable. Is that right?
5. **Rolls.** Is the barcode printed by Stylified on the roll when it arrives, or does the supplier print it? What does a roll carry: fabric type, metres, supplier,
   rate? Is cutting recorded as metres used per lot, with wastage?
6. **Challan.** One challan per handover, or per bundle? What must be on it (GST challan format, or an internal slip)?
7. **QC.** Does QC pass or fail whole bundles, or count pieces? Does a rejected piece go back to a stage (rework) or stop?
8. **Scanner hardware.** Phone camera, or Bluetooth or USB scanners? (Decides whether a bundle needs a 1D barcode or a QR is enough.)

## A way to build it in order (to confirm after the answers)

1. **Handover with both-side confirmation, mismatch with an owner, custody view** (extends what is built; no new hardware).
2. **Scan flow on a phone**: a bundle's code moves it (scan out at one point, scan in at the next); the supervisor's ID is scanned to take responsibility.
3. **Lot rates and automatic wages**; **printed challan** per handover.
4. **Fabric rolls**: barcode, type, metres, use per lot; reasons on shortages; costing that absorbs them (this is the Phase 2 work, now with the client's own words).

None of this is quoted or promised yet; it changes the Phase 2 list in the proposal (fabric, costing, dispatch) and adds handover, custody and challan.
