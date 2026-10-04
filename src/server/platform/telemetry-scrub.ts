/**
 * What may leave the deployment in a crash report.
 *
 * Audit finding F-04 (`taskplans/archive/46C_findings_ledger.md`). The platform already
 * redacts thoroughly — `redactMessage` and `redactFieldsForLog` in
 * `observability.ts` — but that redaction lives in `log()`, and Sentry does not
 * go through `log()`. Sentry captures thrown exceptions directly from the
 * framework, so none of it applied.
 *
 * That matters here more than it would in most codebases, because this one
 * deliberately puts business detail into error messages so operators get
 * failures they can act on:
 *
 *     E_VALIDATION: no price for Century Club Prime 18mm for this customer
 *     E_FORBIDDEN: godown <uuid> is outside this actor's scope for Read <entity>
 *
 * Those are the right messages for an operator reading a support ticket and the
 * wrong ones to hand to a third-party SaaS. This module is the boundary.
 *
 * ONE IMPLEMENTATION, NOT TWO. It composes `redactMessage`, the same function
 * the logger uses, and then adds what a crash report specifically leaks. Two
 * independent scrubbers would drift, and the one that drifted would be
 * discovered by finding customer data in an incident tool.
 */
import { redactMessage } from "./redaction";

/**
 * A bare UUID identifies a tenant, a godown, a role or a record. On its own it
 * is not a name, but it is a stable handle into someone's business and it is
 * the thing that makes two otherwise anonymous reports correlatable.
 */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** 15 characters, fixed shape. A supplier's or customer's tax identity. */
const GSTIN = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;

/** Ten digits, optionally +91-prefixed. */
const PHONE = /\b(?:\+?91[\s-]?)?[6-9][0-9]{9}\b/g;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * A connection string with credentials in it. `/api/ready` already strips this
 * shape before returning it to a caller; a driver error that reaches Sentry
 * instead has taken a different path to the same exposure.
 */
const CONNECTION_CREDENTIALS = /:\/\/[^\s/@]+:[^\s/@]+@/g;

/**
 * The part of a business error message that follows its code.
 *
 * `E_VALIDATION: no price for Century Club Prime 18mm for this customer`
 * becomes `E_VALIDATION: [message withheld]`.
 *
 * This is aggressive, and that is the point. The code and the stack trace say
 * what failed and where, which is what a crash report is for; the interpolated
 * text says which customer and which board, which is the tenant's business.
 * Anyone who needs the full message has the tenant's own audit trail and the
 * application log, neither of which leaves the deployment.
 */
const BUSINESS_ERROR = /\b(E_VALIDATION|E_FORBIDDEN|E_CONFLICT|E_CAPABILITY_(?:INACTIVE|UNKNOWN|DEPENDENCY_INACTIVE|VERSION_INCOMPATIBLE)):\s*[^\n]*/g;

/** Applies every rule, in an order where later ones cannot re-expose earlier. */
export function scrubTelemetryText(text: string): string {
  return redactMessage(text)
    .replace(CONNECTION_CREDENTIALS, "://[redacted]@")
    .replace(BUSINESS_ERROR, "$1: [message withheld]")
    .replace(GSTIN, "[gstin]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(UUID, "[id]");
}

/**
 * Scrubs a Sentry event in place and returns it, or null to drop it entirely.
 *
 * Written against a structurally-typed shape rather than importing Sentry's
 * `Event`: this file is in `src/server/platform/` and the platform must not
 * take a dependency on a particular telemetry vendor. The Sentry config passes
 * its event in; if the vendor changes, this file does not.
 */
export type ScrubbableEvent = {
  message?: unknown;
  exception?: { values?: Array<{ value?: unknown; type?: unknown; stacktrace?: unknown }> };
  breadcrumbs?: Array<{ message?: unknown; data?: unknown }>;
  request?: { url?: unknown; headers?: Record<string, unknown>; data?: unknown; cookies?: unknown };
  extra?: Record<string, unknown>;
  user?: Record<string, unknown>;
};

export function scrubTelemetryEvent<T extends ScrubbableEvent>(event: T): T | null {
  if (typeof event.message === "string") {
    event.message = scrubTelemetryText(event.message);
  }

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === "string") {
      const code = value.value.match(/\bE_[A-Z_]+(?=:)/)?.[0];
      value.value = `${code ?? "Error"}: [message withheld]`;
    }
    // Local variables, source context and absolute paths can carry tenant data.
    delete value.stacktrace;
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === "string") crumb.message = scrubTelemetryText(crumb.message);
    // Breadcrumb data is free-form and frequently carries a request body.
    // There is no shape to scrub reliably, so it is dropped.
    if (crumb.data !== undefined) delete crumb.data;
  }

  if (event.request) {
    if (typeof event.request.url === "string") {
      event.request.url = scrubTelemetryText(event.request.url);
    }
    // A request body on a server action is the user's form input, and cookies
    // carry the session. Neither belongs in a crash report at any level of
    // scrubbing, so both are removed rather than filtered.
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      const kept: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(event.request.headers)) {
        // An allow-list, not a deny-list: a deny-list of header names is a list
        // somebody has to remember to extend, and the first header forgotten is
        // the one that leaks.
        if (["user-agent", "referer", "content-type"].includes(name.toLowerCase())) {
          kept[name] = typeof value === "string" ? scrubTelemetryText(value) : value;
        }
      }
      event.request.headers = kept;
    }
  }

  // `extra` is whatever a caller attached. Unknowable shape, so it goes.
  if (event.extra) delete event.extra;

  // Keep the user's id so reports can be correlated; drop the fields that
  // identify a person. An id is already scrubbed to `[id]` if it is a UUID
  // appearing in text, but here it is structured and useful.
  if (event.user) {
    const { id } = event.user as { id?: unknown };
    event.user = id === undefined ? {} : { id };
  }

  return event;
}
