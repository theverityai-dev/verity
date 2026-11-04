# Verity prospects: India, 20,000 businesses

Organised, owner-led Indian businesses across the 123 business types on the Verity site
(`verity-explore/businesses/`), ranked by how well they fit Verity's buyer.

- `verity_prospects_india_20000.xlsx`: read-me sheet, all 20,000 rows, one sheet per industry.
- `verity_prospects_india_20000.csv`: the same rows, for CRM import.
- Generator: `scripts/prospects/` (see its README).

## Source and licence

Overture Maps Foundation, Places theme, release `2026-10-21.0`, public business listings only.
Overture Places is published under CDLA-Permissive-2.0; some records carry upstream source terms
(`sources` field). Attribution: © Overture Maps Foundation and its contributors.

## What is in it

4.67M Indian places → 2.69M matched to a Verity business type → 1.87M distinct businesses
(one row per business: grouped by own website domain, else by name within a state) → 690k passed
the quality bar → top 20,000 kept with a per-type quota (square root of pool, minimum 60 where
the pool allows).

- **Quality bar:** open, has a phone, and has a digital footprint (own website domain, company
  email domain, or 2+ locations).
- **Excluded:** multinationals and national chains, global-brand store-locator pages,
  foreign-domain subsidiaries, dealers listing a manufacturer's site, government bodies, chains
  with more than 40 listings. Public "Limited" companies are scored down, not removed.
- **Fit:** A = top 25% by score, B = middle 50%, C = bottom 25% (nurture, not reject).
- Coverage: 99% phone, 93% email, 69% with 2+ locations; 122 of 123 types (no online marketplaces).

## Before outreach

Contacts come from public listings and may be stale; verify before use. Scrub numbers against
the NCPR/DND registry before calls or SMS (TRAI). Honour opt-outs and use the data only for
business outreach under the DPDP Act 2023. Business type comes from each listing's own category,
so a small share is mislabelled.
