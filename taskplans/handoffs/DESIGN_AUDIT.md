# Design and UX audit, 2026-10-22 (ADR-053 rollout)

Scope: the Stylified demo screens on the new Obsidian glass system, plus a codebase sweep for drift. Method: screenshots in dark and
light at 1440 wide, server timings from the dev log, code search for patterns that bypass the shared tokens and parts.
Severity: P0 breaks the feel of the product, P1 visible quality gap, P2 consistency or hygiene.

## Fixed in this round

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| 1 | P0 | No pressed state on cards and links, so a click gave nothing back on the frame it landed | `a:has(> .glass-card)` and card links had hover only; buttons had opacity only | `globals.css` pressed rule (scale .985) on card-links and glass-inset buttons; `Button` scales .97 |
| 2 | P0 | No navigation feedback; the screen just waited on the server | warm renders 0.3 to 1 s, cold dashboard 2.7 s, `proxy.ts` spikes 1.0 to 1.7 s | `NavProgress` top bar starts on the click and finishes on the new address |
| 3 | P1 | Loading state was one 24 px spinner in an empty area | `RouteLoading` | page-shaped skeleton (title, hero, side card, four cards) |
| 4 | P1 | Glass looked cheap: hard 1 px lines on two edges read as a bevel; then dimmed by weakening everything | review feedback | rim redrawn as a soft diagonal gradient (`::after` mask) plus a fading top highlight (`::before`), fill kept subtle, blur 24, blooms mid strength |
| 5 | P1 | Avatar initials took a bracket as a letter ("K(" for "Karigar C (pasting)") | karigars screen | `initials()` ignores bracketed text and punctuation, test added |
| 6 | P1 | Large bold numerals and loose-tracked titles left from the old system in 12 places (sign-in, public pages, charts, outreach, karigar card) | grep | Light display weight, tight tracking |
| 7 | P1 | Tiny segments in a continuous piece bar rendered as round dots | bundle page | straight segments, 4 px minimum |
| 8 | P2 | `surface-sunken` was an opaque grey slab inside glass cells, about 160 uses in 86 files | grep, screenshots | token is now a faint wash, so every inner panel follows |
| 9 | P2 | Project `CLAUDE.md` still described the iOS system, so the next screen would drift back | file | Experience System section rewritten to ADR-053 |
| 10 | P2 | Floor lanes scrolled sideways and clipped cards on desktop | dashboard | auto-fit grid, one column per lane while they fit, then wrap |

## Open

| # | Sev | Finding | Next step |
|---|-----|---------|-----------|
| A | P1 | `proxy.ts` takes 1.0 to 1.7 s on some requests (session renewal against the identity provider) | measure how often renewal runs; renew ahead of expiry in the background so a click never waits on it (platform auth, needs its own review) |
| B | P1 | Page queries load every bundle and entry (`loadAll`) on each view; fine at demo size, linear in history | narrow per page, aggregate in SQL or cache per tenant with invalidation on command |
| C | P1 | Other clients' modules (floor, kitchen, CRM, HR, finance, documents, HQ, public pages) get the new tokens and shared parts but have not been looked at one by one | screenshot sweep per module in both themes with `qa-loop`, fix what the shared parts miss |
| D | P1 | Pictures: no file field on lot, return or karigar, so thumbnails, covers and evidence photos cannot show yet | add cover and evidence file references through the platform file store (new model fields, an ADR for evidence capture) |
| E | P2 | About 48 hand-built card or button styles in 31 files (inputs and buttons already use shared tokens; print documents and danger banners are the real exceptions) | move danger banners to a shared `Notice`; leave print documents plain by design |
| F | P2 | "The destination stream closed early" is logged when a navigation is cancelled | filter this error in the logger |
| G | P2 | No automated guard against drift | add a test that fails on new hard-coded hex colours, `bg-white`, and bold large numerals outside an allowlist |
| H | P2 | Dev-only: the first visit to each route compiles for 4 to 13 s | none (production does not compile); do not judge click speed from dev |

## Not claimed

Nothing here measures production speed; the timings are from the local dev server. Contrast on the new glass was checked by
calculation for the main text colours, not with an automated tool on every screen.
