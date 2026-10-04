# Task Plan 46A — API Inventory

Endpoint inventory companion to Task 46. Populated from the repository at
`6604a30`, not from assumptions. **Permanent reference artifact** — re-read at
every client security questionnaire and every framework upgrade.

Method for every row: the route or action was opened and its guard read. A cell
saying "None" means no check was found in the code path, not that none was
looked for.

---

## 1. HTTP routes

| Method | Route | Auth | Principal | RBAC | Tenant scope | Validation | Mutation | Audit | Rate limit | Sensitive response |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/health` | None | None | None | None | None | No | No | **None** | No — liveness only |
| GET | `/api/ready` | None | None | None | None | DB probe | No | No | **None** | Error detail, credential-sanitised (`sanitize()` strips `user:pass@`) |
| GET | `/api/metrics` | Shared operator secret **in production only** | Secret bearer, not a user | Secret gate, not tenant RBAC | None — platform-wide | Constant-time header compare | No | No | **None** | Yes — operational counters. **Open outside production** |
| GET | `/api/scheduled` | `CRON_SECRET` bearer | Secret bearer | Secret gate, not tenant RBAC | `?tenant=<uuid>` or `all` | Query param + cadence allow-list | Yes | Yes, via scheduled work | **None** | Run summary |
| POST | `/api/scheduled` | `CRON_SECRET` bearer | Secret bearer | Secret gate, not tenant RBAC | `?tenant=<uuid>` or `all` | Query param + cadence allow-list | Yes | Yes | **None** | Run summary |
| POST | `/monitoring` | **None** | None | None | None | None (opaque envelope) | No | No | **None** | Forwards to Sentry — see F-04 |

`/monitoring` is not a file in this repository. It is created at build time by
`withSentryConfig`'s `tunnelRoute` and is easy to miss in a route inventory
taken by listing `route.ts` files. It is listed here because it exists at
runtime.

**Good properties confirmed by reading:** `/api/scheduled` and `/api/metrics`
both use `node:crypto` `timingSafeEqual` and both return **503 when no secret is
configured** rather than running unauthenticated — failing closed on
misconfiguration, which is the harder case to get right. `/api/ready` strips
credentials out of driver error text before returning it.

## 2. Server actions — tenant

All in `src/server/actions/platform.ts`.

| Action | Auth | Principal | RBAC | Tenant scope | Validation | Mutation | Audit | Rate limit |
|---|---|---|---|---|---|---|---|---|
| `runCommand(key, input, revalidate?)` | `requireActor()` | Session user + active membership | **Yes** — `executeCommand` runs `authorize()` on the command's verb×entity | From actor, never from payload | Command's own Zod schema | Yes | Yes — activity + events | **None** |
| `runQuery(key, input)` | `requireActor()` | Session user + active membership | Yes — `executeQuery` authorizes and applies field redaction | From actor | Query's Zod schema | No | No | **None** |
| `switchOrganization(membershipId)` | `requireActor()` | Session user | Membership re-verified against the authenticated user | Target derived from the verified membership | Membership must be in `listMemberships()` | Yes — session context | Yes — `RoleAssigned` security event | **None** |
| `signInWithPassword(formData)` | **Public by definition** | Anonymous → Supabase Auth | None | None | Supabase | Yes — session | Yes — `AuthSuccess` / failure events | **None — F-01** |
| `signOut()` | Session | Session user | None | None | None | Yes | Yes | n/a |

`signInWithPassword` takes `FormData` rather than positional arguments
specifically because Next.js logs server-action arguments, and the previous
signature wrote plaintext passwords into the server log. That fix is in place
and is worth keeping visible in this table so it is not undone.

## 3. Server actions — HQ operator

All in `src/server/actions/hq.ts`. None of these carries its own guard; every
one delegates to `src/server/platform/operator.ts`, which calls
`requireOperator()`. That is the correct shape — **one operator check, not
five** — and was verified by reading each delegate.

| Action | Auth | Principal | RBAC | Tenant scope | Mutation | Audit |
|---|---|---|---|---|---|---|
| `createClientAction` | `createClient` → `requireOperator()` | Platform operator | Platform authority | Creates a tenant | Yes | Yes |
| `enterClientAction` | `enterClient` → `requireOperator()` | Platform operator | Platform authority; refuses the platform tenant | Target tenant | Yes — session | Yes |
| `runClientCommand(tenantId, …)` | `operatorActorFor` → `requireOperator()` | Operator, acting through a real membership and role in that client | Full command authorization, same path as a tenant user | Named tenant, validated | Yes | Yes |
| `runClientQuery(tenantId, …)` | `operatorActorFor` → `requireOperator()` | Same | Full query authorization | Named tenant, validated | No | No |

**Authorization is enforced at the data-access boundary, not at the route.**
Several HQ pages carry no `requireOperator()` call of their own — but every one
of them obtains its data through `platformSettings()`, `clientDirectory()`,
`platformAudit()` or `runClientQuery()`, and each of those guards internally.
This was checked page by page rather than assumed, because layout-level auth in
the App Router is not a reliable boundary: a layout and a page render in
parallel, so a guard that lives only in a layout does not reliably prevent the
page's data fetch from running. **No page was found relying on a layout guard
alone.**

## 4. What the surface does not have

- **No rate limiting anywhere.** No middleware, no per-IP or per-account
  throttle, on any route or action, including sign-in. See F-01.
- **No `middleware.ts`.** Nothing runs at the edge before a route. Not a defect
  on its own — the guards are deeper and that is the safer place for them — but
  it means there is no chokepoint at which a rate limit or origin check could be
  applied today without adding one.
- **No security response headers.** `next.config.ts` sets `poweredByHeader:
  false` and nothing else: no CSP, HSTS, `X-Frame-Options`,
  `X-Content-Type-Options` or `Referrer-Policy`. See F-03.
- **`serverActions.bodySizeLimit` is raised to 15 MB** from the 1 MB default.
  Every server action, including the unauthenticated sign-in, will accept a
  15 MB body. See F-02.
