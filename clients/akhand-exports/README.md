# Akhand Export, Noida: business analysis and demo (2026-11-05)

Internal. What we know about the prospect, how their work maps onto the Stylified build, what the demo shows, what it does not,
and what to ask them in the first meeting.

## 1. What is publicly known

There is one public source: the firm's IndiaMART seller page (`m.indiamart.com/akhand-export`). Everything below comes from it.
None of it has been checked against official records.

| Fact | Value |
|---|---|
| Name | Akhand Export ("Exporter & Manufacturer from Noida") |
| Place | Noida, Gautam Buddha Nagar, Uttar Pradesh (no street address published) |
| Head | Kaushalendra (listed as CEO; GST legal status is proprietorship, so he is the proprietor) |
| GSTIN / IEC | 09EMPPS1632K2ZD / EMPPS1632K (GST registered 2021) |
| Nature of business (GST) | Manufacturer; also export, import, factory, retail |
| Turnover bracket (IndiaMART) | 0 to 40 lakh. This is the bracket the listing shows and is probably out of date |
| HSN codes dealt in | 6114 and 6113 (knitted garments), 6209 (babies' garments), 6210 / 6201 (woven outerwear, raincoats) |
| Range listed | Ladies wear (tops, crop tops, skirts, palazzos, woollen coats, long jackets), ladies dresses and one-piece dresses, kids wear (tees, rompers, jumpsuits, designer dresses, night dresses), baby wear, men's hoodies, sweatshirts, round neck tees, printed shirts, lowers, shorts, trousers, raincoats; also printed sarees and cotton fabric |
| Not published | Address, employee count, machines, capacity, buyers, export markets, prices, MOQ |

## 2. What kind of business this is

A small proprietor-run garment export house in the Noida cluster (DGFT named Noida a Town of Export Excellence for apparel). The HSN
codes are the most reliable clue: the business is mainly **knits** (tees, hoodies, sweatshirts, rompers, kids wear), with some woven
outerwear. The very wide range on the listing (sarees to raincoats) is typical of a small house that takes whatever the buyer asks
for and sends much of the work out to job workers; it is not a sign of many in-house lines.

How such a house runs an order, in the order the work happens:

1. **Buyer enquiry and sampling.** A foreign buyer (often through a buying agent) sends a tech pack. The house makes a proto, then a
   fit sample, then a PP (pre-production) sample, and gets each approved. Salesman samples go out for new buyers.
2. **Purchase order.** One style, a colour, a quantity, a **size break** (for example 2-3Y 200, 4-5Y 200, 6-7Y 200), a price, an
   ex-factory date, the packing instructions.
3. **Fabric.** Knit fabric is bought dyed from mills in Tiruppur and Ludhiana, in rolls **weighed in kilograms**, priced per kg.
   Trims (labels, zips, snaps, hang tags, polybags, cartons) are bought per order.
4. **Cutting.** The cutting master lays the fabric and cuts by size; the cut pieces go into numbered **bundles** by size.
5. **Print or embroidery.** Usually sent out to a job worker in Sector 63 or Okhla, and checked when it comes back.
6. **Stitching.** Overlock and flatlock machines. Done by piece-rate tailors in the house and by **outside fabricators** (job work),
   who take bundles away on a challan and bring them back.
7. **Thread cutting, press, final checking.** Piece-rate or daily-wage. Checking finds open seams, needle holes, shade variation, print
   faults and measurements out of tolerance. The buyer or a third party then runs an AQL inspection on the packed goods.
8. **Packing and shipment.** Packed by the size ratio into inner boxes and export cartons; shipped by sea (FOB Nhava Sheva or Mundra)
   or by air against an export invoice and packing list. Small surplus is sold in the domestic market (Gandhi Nagar, Delhi).
9. **Money.** Karigars and job workers are paid weekly against what they made, less advances and deductions; the house watches cost
   per piece against the FOB price.

Points 2 to 9 are how the trade works in this cluster, not facts about Akhand. Confirm them in the first meeting (section 6).

## 3. Why the Stylified build fits

Steps 3 to 7 and the wages in step 9 are the Stylified flow: rolls, a lot with a rate card, a cut into counted bundles, bundles given out
and taken back stage by stage with good, rejected, rework and short, a challan for people without a phone, the receiver's count as the
truth, a case and a charge request for lost pieces, ready garments, and each karigar's account. Nothing in the `piecework`
capability is specific to Ludhiana shirts; the demo is the same screens with Akhand's data. No platform or capability code changed.

| Export house | In the demo |
|---|---|
| Buyer's purchase order for one style | A **lot**. Its name carries the PO number and the buyer; its note carries the size break and shipping terms |
| Size break | Bundle groups at the cut, one size per bundle note |
| Knit fabric by weight | Rolls received in **kg**, priced per kg; the lot shows the kilograms it used |
| Print or embroidery job work | An optional first stage given to an outside unit; a plain tee's rate card skips it |
| Outside fabricator | A karigar of kind "outside" with an address; the challan goes with the bundle |
| Final checking | The last stage; its accepted pieces are export-ready garments |
| Shipment | A "Shipped" movement out of ready stock, with the buyer and the export invoice number |
| Cost per piece | Lot costing: fabric plus wages plus trims, testing, packing (a shared thread bill split by pieces cut) |

## 4. What the demo contains

Seed: `prisma/seed-akhand.ts`. Tenant "Akhand Export", flagged as a demo. Everything is invented: the buyers (Nordvik Kids, Little Tern,
Kestrel Outfitters, Maison Bleue), the karigars, the mills and every number.

- **Five stages:** Print / Embroidery (optional), Stitching (overlock and flatlock), Thread cutting, Press, Final checking.
- **Fifteen knit rolls in kg** from two mills: organic interlock, fleece, single jersey, rib.
- **Eight people:** an outside printer, an outside fabricator, two tailors, thread cutting, press, checking, and a helper with no rate of
  their own (paid the stage default).
- **Five buyer orders:**
  - LOT-0001, PO LT-504, baby romper for the UK: made, checked, closed, shipped on two export invoices plus shipment samples; costs
    include labels, a lab test and export cartons.
  - LOT-0002, PO NV-2611, kids zip hoodie for Sweden, 600 pieces, three sizes: running. One bundle went through every stage with a print
    reject, a seam rework, a lost piece (charge approved) and two checking rejects; one bundle is overdue at the outside fabricator with
    a handover count difference; others sit with a tailor and at the printer.
  - LOT-0003, salesman samples for a new Australian buyer: on hold for fit comments.
  - LOT-0004, PO KO-77, plain tee: skips print, cut straight to stitching.
  - LOT-0005, PO MB-118, ladies rib crop top for France: draft, waiting for its cut; its rib is on the shelf.
- **Floor:** one supervisor over every stage, two deduction requests waiting (one within the manager's limit, one only the owner can
  decide), a closed day with a Hindi note.
- **Ready stock:** domestic surplus counted at launch, part of it sold to a Delhi wholesaler.
- **Quality inspections (AQL, ISO 2859-1):** LOT-0001's buyer final passed (32 of 200 checked, level II, AQL 2.5 / 4.0); LOT-0002 has an
  inline check that failed on open seams and a re-check after rework that passed.
- **Packing lists:** PL-0001 (8 cartons, 120 pcs) and PL-0002 (5 cartons, 76 pcs) for LOT-0001's two shipments, with the size
  assortment per carton, net and gross weight and CBM, each printable from the lot.
- **Pictures:** a generated cover for every lot (`public/demo/akhand`, prompts in `image-prompts.md`).

Logins (local demo, `bash scripts/demo-env.sh up`; `bash scripts/demo-env.sh logins` prints the table and the shared password):
`akhand-owner`, `akhand-manager`, `akhand-supervisor`, `akhand-munshi`. Reset: `DEMO_TENANT_NAME="Akhand Export"` with
`prisma/reset-demo.ts --yes`, then run the seed again (or `demo-env.sh up --reset`, which reseeds every tenant).

## 5. What an export house needs that the demo does not have

Built on 2026-11-06 because none needs anything from the client (each follows an industry standard or is plain document work):
the AQL inspection record, the packing list and the lot pictures. They are generic to the garment capability, so Stylified can use
them too once its roles get the two new grants. What is left needs the client's own answer first; say these plainly in the meeting.

| Gap | Why it matters to them | Size |
|---|---|---|
| Buyer and purchase-order master, with a size and colour matrix | Today the PO lives in the lot's name and note. Several lots per PO, and progress against each size, need a real order | Medium |
| Sampling tracker (proto, fit, PP, salesman samples, buyer comments, approval dates) | Most of a small house's lost time is waiting on sample approvals | Small to medium |
| Time and action calendar against the ex-factory date | Late shipment means air freight at the house's cost | Medium |
| Export invoice, shipping documents, LUT, RoDTEP and duty drawback tracking, foreign-currency receipts | The commercial side of exporting; usually the CA or a CHA does it today | Large; ask what they use first |
| Trim and accessory stock per order | Zips, labels, snaps are counted against each PO | Medium |
| Carton labels (shipping marks printed per carton) | Most buyers send their own label format; ask for one | Small |

Why each of these waits: the PO master decides whether a size grid is kept below the bundle (Stylified deliberately keeps bundles
size-free); sampling stages and the T&A milestones differ by buyer; export documents depend on whether their CA or CHA already
prepares them; trims depend on whether they stock trims or buy per order.

## 6. Questions for the first meeting

1. Which products are most of the volume: knits (tees, hoodies, kids wear) or woven? Which buyers and countries?
2. How many people in-house, how many machines, and how much goes to outside fabricators and printers?
3. How are karigars paid: per piece, per day, or both? Weekly? Who keeps the register now?
4. Is the unit of tracking a bundle, a size, or the whole order? Do they number bundles today?
5. Is fabric bought by kg in rolls, and do they track how much each order used against the marker plan?
6. Who does export documents and incentives (in-house, CA, CHA)? Is that a problem they want solved?
7. Do buyers send their own inspectors? What do they ask for on paper?
8. Who would use a phone on the floor, and in which language?

## Sources

- IndiaMART seller page, Akhand Export: https://m.indiamart.com/akhand-export/aboutus.html (and its product category pages)
- Noida named a Town of Export Excellence for apparel: https://in.fashionnetwork.com/news/Government-awards-noida-town-of-export-excellence-for-apparel,1284247.html
