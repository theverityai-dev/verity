# Task Plan 46B — Sensitive Data Flow

Sensitive-data flow companion to Task 46, traced against the repository at
`6604a30`. **Permanent reference artifact.**

Shape traced for each flow:

```text
Input -> API -> Domain -> Database -> Storage -> Logs -> External systems
```

The last two columns are where this audit found its material issues. The first
five are in good shape.

---

## 1. Authentication credentials

```text
sign-in form -> signInWithPassword(FormData) -> Supabase Auth -> session cookie
```

- **Never touches our database.** No credential material is stored on `User`;
  Supabase Auth owns it and `authUserId` references `auth.users`.
- **Never reaches the log.** The action takes `FormData` precisely because
  Next.js logs server-action arguments and the earlier positional signature
  wrote plaintext passwords to the server log.
- Failure responses do not distinguish "no such user" from "wrong password".
- **Gap:** no rate limit in front of it (F-01).

## 2. Tenant business data

```text
form -> server action -> command (Zod) -> authorize() -> withTenant() -> Postgres (RLS)
```

- Tenant context comes from the authenticated actor, never from the payload
  (PLA-TEN-006). Verified: no command reads a tenant id from input.
- RLS is enabled **and forced** on tenant tables, and the runtime role
  `verity_app` is `NOSUPERUSER NOBYPASSRLS` — re-verified live during this audit
  (`rolsuper=f, rolbypassrls=f`).
- `assertRlsEnforceable()` refuses a bypassing role at startup.
- Reads apply three layers: verb×entity, row scope, field redaction.

## 3. Files and evidence

```text
upload -> two-phase confirm -> Supabase Storage -> key/checksum/size frozen by trigger
```

- A confirmed file's key, checksum and size are immutable by database trigger.
- Storage driver is bound through the platform's extension point; nothing in
  `src/server/platform/` knows the provider.

## 4. Logs — **redacted, and correctly so**

```text
domain -> log() -> redactMessage + redactFieldsForLog -> JSON line -> stdout
```

`observability.ts` runs every log line through `redactMessage()` and every field
through `redactFieldsForLog()`, which consults `isSensitiveField()` and replaces
matches with `[redacted]`, recursing into nested objects. Values are truncated.

Only two raw `console.*` calls exist in `src/server/`, both on failure paths
that carry no business payload (`config.ts` invalid-configuration report, and a
failure to record an `AuthSuccess` event).

**This is the control that F-04 bypasses.**

## 5. External systems — **the gap**

```text
thrown Error -> Sentry SDK -> https://sentry.io  (NO redaction applied)
```

The platform's redaction lives in `log()`. **Sentry does not go through
`log()`.** `withSentryConfig` auto-instruments the framework and captures thrown
exceptions with their messages, and this codebase deliberately puts business
detail into error messages so that operators get actionable failures. Examples
from the current tree:

- `E_FORBIDDEN: godown <uuid> is outside this actor's scope for <verb> <entity>`
- `E_FORBIDDEN: role <uuid> may not <verb> <entity>`
- `E_VALIDATION: no price for <product name> for this customer, and none given`
- `E_VALIDATION: <supplier invoice number> does not add up …`
- `E_VALIDATION: <customer name> …` in credit paths

Those are tenant business facts — product names, supplier document numbers,
internal identifiers — leaving the deployment to a third-party SaaS with **no
`beforeSend` hook and no scrubbing**. See F-04.

Three further properties of the current Sentry setup, all read from
`next.config.ts` and `sentry.*.config.ts`:

- `tracesSampleRate: 1` — 100% of transactions traced, in every environment.
- `org: "factory-qc"`, `project: "factory-qc-platform"` — **legacy VEDA-era
  identifiers**. Verity's production errors report into a different product's
  Sentry project.
- `tunnelRoute: "/monitoring"` — an unauthenticated POST endpoint whose purpose
  is to proxy payloads onward to Sentry's ingest, bypassing ad blockers.

Sentry initialises **only when `NEXT_PUBLIC_SENTRY_DSN` is set**, so a
deployment that leaves it unset has none of this exposure. That is the current
mitigating fact, not a control.

## 6. Encryption keys

```text
caller-supplied key -> encrypt -> ciphertext column
```

The credential-registry key is supplied per call from the application
environment and never stored in the database, so a database dump yields
ciphertext alone. A managed KMS remains an open platform decision (recorded in
`CLAUDE.md`), unchanged by this audit.
