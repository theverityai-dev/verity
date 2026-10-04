# Task 66 — Phase 10A security remediation

Closes the findings opened in `taskplans/46C_findings_ledger.md`.

**Numbering note.** The roadmap names this "Task 47+". `47` is already taken
twice in this repository — `47_nextjs_security_upgrade.md` (the Next.js plan,
which is the one meant) and `47_plywood_business_identity.md` (a plywood slice).
Rather than a third `47`, the Next.js work keeps its existing plan file and the
remaining remediation is gathered here at the next free number. The collision is
recorded rather than silently resolved.

---

## F-00 — Next.js 16.2.10 → 16.3.3

Non-semver-major, as `npm audit` reported. Also clears the two transitive highs
that were pinned by it.

| | Before | After |
|---|---|---|
| advisories | 11 (10 high, 1 moderate) | 8 (7 high, 1 moderate) |
| `next` | high — Turbopack middleware/proxy bypass; server-action DoS | gone |
| `postcss` | high — arbitrary file read via `sourceMappingURL` | gone |
| `sharp` | high — inherited libvips CVEs | gone |

Verified after upgrade: typecheck clean, lint clean, build clean, standalone
`server.js` produced with the Prisma engine traced into it, 70 routes.

The two advisories mattered specifically because they describe this
configuration: the project builds with Turbopack and uses server actions as its
primary write path.

## F-01 / F-02 — throttling and body size

`src/server/platform/rate-limit.ts`. Fixed-window, in-process, applied to
sign-in at ten attempts per five minutes.

**Keyed on the account, not the IP**, and the reasoning is the point: an IP key
fails in both directions — a corporate NAT puts a whole office behind one
address, so one mistyped password locks out colleagues, while an attacker with a
proxy pool defeats it for nothing. The account is what is under attack.

**Counted before the credential is checked.** Counting only failures would let a
correct-password probe run free.

**The refusal message does not say the account is throttled.** Saying so would
reinstate the account-enumeration oracle that the generic "those credentials
were not accepted" exists to close — an attacker could learn an address is real
by attacking it until the message changed.

**Stated limitation:** per process. Across N instances the effective limit is
N×. That is why the limit is set well below what a human needs rather than just
below what an attacker wants. A shared-store limiter belongs with Phase 13,
where there is a known topology to size against.

Body limit 15 MB → 2 MB. Nothing needed 15: file uploads never transit the
application (`files.ts` issues a presigned URL and the client uploads directly
to storage). 2 MB rather than the 1 MB default so the largest legitimate action
payload — the GSTR-2B import, capped at 5,000 rows — fails on its own row cap
with a message an accountant can act on, not on a transport limit that explains
nothing.

## F-03 — security headers

`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains`.

**No CSP, deliberately, and the ledger entry stays open.** A CSP that Next.js
can actually run needs a per-request nonce for its inline bootstrap, which means
middleware and a matching nonce on every script — real breakage risk that must
not be taken blind in a remediation pass. A `report-only` CSP would be theatre:
it protects nothing and creates a report sink nobody reads. CSP is its own task.

No `preload` on HSTS: that is a one-way submission to a browser-vendor list and
is the deployment's decision, not this file's.

## F-04 / F-05 / F-06 — telemetry

`src/server/platform/telemetry-scrub.ts`, wired through `beforeSend` in all
three Sentry runtimes.

It **composes `redactMessage`**, the same function the logger uses, rather than
reimplementing redaction. Two independent scrubbers drift, and the one that
drifted would be discovered by finding a customer's data in an incident tool.

What it removes: the body of any `E_*` business error (keeping the code and the
stack, which is what a crash report is for), UUIDs, GSTINs, emails, phone
numbers, connection-string credentials, the whole request body, cookies,
`extra`, and every request header outside a three-name allow-list. An
allow-list, not a deny-list — a deny-list is a list somebody must remember to
extend, and the first header forgotten is the one that leaks.

`tracesSampleRate` 1 → 0.1, environment-overridable. `sendDefaultPii: false`
stated explicitly rather than left to an SDK default that can change between
majors.

`org`/`project` were the hard-coded legacy VEDA values `factory-qc` /
`factory-qc-platform`, so Verity's errors reported into another product's Sentry
organisation. Now environment-driven, because which organisation a deployment
reports into is a deployment fact. Sentry initialises only when DSN, org and
project are all set, so the wrong-project failure cannot recur silently.

`tunnelRoute` is now opt-in via `SENTRY_TUNNEL_ROUTE`. Its only purpose is
evading ad blockers, and it creates an unauthenticated endpoint that forwards
request bodies to an external host — not a trade an enterprise deployment should
make without choosing it.

## F-09 — the Layer-2 sweep (new finding, found by this task)

The ledger observed that four of the five already-fixed defects shared one
shape: Layer 1 enforced, Layer 2 missing. That argued for a sweep rather than
five point fixes. The sweep was run, and **found seven more**.

Every plywood query was classified by whether it reads godown-anchored records
(`stock_balance`, `stock_ledger_entry`, purchase and sales orders, reservations,
racks, receipts). Of 36 queries, 27 applied no godown filter — but most of those
read records that are *not* anchored to a godown, where a filter would be a
scope rule with no basis in the model. Seven were genuine:

| Query | What was readable from any godown |
|---|---|
| `purchaseOrderDetail` | another godown's order — supplier, prices, receipts |
| `salesOrderDetail` | another godown's order — customer, credit position, prices |
| `purchaseMatch` | the three-way match for another godown's purchase |
| `goodsReceiptDetail` | what arrived, at what cost, into which godown |
| `purchaseReviewQueue` | the accountant's queue, tenant-wide |
| `listGodownRacks` | the physical layout of another branch's godown |
| `stockAvailability` | another branch's stock, by naming its godown id |

All seven closed. Two patterns applied throughout:

- **Scope in the predicate, not after the read.** `findFirst` with the location
  in the `where`, never `findUniqueOrThrow` followed by a check — a read that
  returns the row and refuses afterwards has already read it.
- **An explicit godown id is intersected with the reachable set, never
  substituted for it**, so naming another branch's godown returns nothing rather
  than its contents.

`purchaseMatch` and `goodsReceiptDetail` now return `null` for out-of-scope as
well as not-found, and the two are indistinguishable on purpose: telling an
operator that a record they may not read nevertheless exists is the fact the
scope was there to withhold.

## Tests

`rate-limit.test.ts` (5) and `telemetry-scrub.test.ts` (7). The telemetry tests
assert against the actual message shapes this codebase produces — a real
`E_VALIDATION` with a product name in it, a real scope refusal with a UUID —
rather than against synthetic strings, because the finding was about those
specific messages.

## Still open after this task

- **CSP** (part of F-03) — needs nonce middleware; own task.
- **F-07** `/api/metrics` open outside production — deliberate, P3.
- ~~**F-08**~~ **resolved.** Reachability traced per package: six are build- or
  development-time. The seventh, `dompurify`, entered through `posthog-js` — a
  runtime dependency with zero references anywhere in the source. Removed;
  8 advisories → 7, all now build-time.
- **Shared-store rate limiting** — Phase 13, with a known topology.
