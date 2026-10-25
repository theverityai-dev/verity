# Stylified: pricing (internal), 2026-10-25

Replaces the 2026-10-22 offer (₹25,000 + GST once, ₹15,000 a month GST included). The owner's two options, worked out. Amounts in rupees.
GST is shown at 18%. PlotArmour is registered in Delhi and Stylified is in Punjab, so IGST at 18% is expected; confirm with the accountant.

## The two options

| | Option A, own it | Option B, start light |
|---|---|---|
| One-time, before GST | 90,000 | 25,000 |
| GST on it | 16,200 | 4,500 |
| One-time invoice total | 1,06,200 (53,100 at kickoff, 53,100 at go-live) | 29,500 (14,750 and 14,750) |
| Monthly, before GST | 8,500 | 12,000 |
| GST on it | 1,530 | 2,160 |
| Monthly invoice total | 10,030 | 14,160 |

The software and the scope are identical on both. Only the way of paying differs. If the owner wants Option A to include more (for example the
next steps in section 5 of the proposal), say so and document 1 and document 2 change.

## Cost over time, before GST

| After | A | B | Cheaper |
|---|---|---|---|
| 3 months (the initial term) | 1,15,500 | 61,000 | B by 54,500 |
| 12 months | 1,92,000 | 1,69,000 | B by 23,000 |
| 18 months | 2,43,000 | 2,41,000 | B by 2,000 |
| 19 months | 2,51,500 | 2,53,000 | **A by 1,500** |
| 24 months | 2,94,000 | 3,13,000 | A by 19,000 |
| 36 months | 3,96,000 | 4,57,000 | A by 61,000 |

Break-even: (90,000 - 25,000) / (12,000 - 8,500) = 65,000 / 3,500 = 18.6 months, so A is cheaper in total from the 19th month.
Against the old offer (25,000 once and 12,711.86 a month before GST), Option B is the same entry price and a slightly lower monthly.

## What the money has to cover (assumptions, not measured)

- Hosting: the 2026-10-22 research put the provider floor at Vercel Pro from about $20 and Supabase Pro about $25 a month plus compute, roughly
  ₹3,800 to ₹4,500 a month at current rates. Both options pay this from the monthly amount.
- Support: the terms promise a first response in 4 working hours for critical problems, 1 day for normal ones, and up to 4 hours of configuration
  work a month. That is the part to watch.
- Left after hosting: about ₹4,000 to ₹4,700 a month on A, about ₹7,500 to ₹8,200 on B.

## My reading

- A is the better deal for the client if they stay beyond about 19 months, and it brings in ₹65,000 more before GST in the first month. Its monthly
  amount covers hosting and little else, so a busy support month costs us money. If A is offered, consider "up to 2 hours of configuration a month"
  in document 3 section 4 instead of 4, and quote extra hours at a stated rate.
- B is the easier yes: ₹25,000 is a small decision for a factory that has not yet seen its own lot on Verity. It carries more margin per month.
- Both are low against what the system does. Lead with whichever the owner is more comfortable defending; both documents show both options and the
  comparison, ex-GST, with no emphasis on commitment (the owner's standing instruction for the proposal pack).
- Anything beyond document 2 (join or link lots, Hindi on office screens, dispatch, WhatsApp, Tally export, offline, a second unit) is a change request
  priced separately and never folded into the monthly amount.

## Where the figures live

`proposal/01-proposal.html` section 03 (client view, with the comparison table), `proposal/03-service-terms.html` section 02 (invoice amounts with GST).
Rebuild the PDFs after any change: `node clients/stylified/proposal/build-pdf.mjs`.
