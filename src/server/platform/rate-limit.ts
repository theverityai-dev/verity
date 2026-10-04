/**
 * Request throttling.
 *
 * Audit finding F-01 (`taskplans/archive/46C_findings_ledger.md`): nothing in this
 * application limited request rate anywhere, sign-in included. Failure
 * responses correctly refuse to distinguish "no such user" from "wrong
 * password", which closes the enumeration oracle — but it also means an
 * attacker's only cost is request volume, and nothing put a cost on volume.
 *
 * WHY IN-PROCESS, AND WHAT THAT DOES NOT COVER
 * This is a fixed-window counter in the process's own memory. It is chosen
 * deliberately over a Redis or database counter, and the trade-off must be
 * stated rather than discovered later:
 *
 *   - It works with no new infrastructure, no new dependency, and no new
 *     network hop on the authentication path. A rate limiter that fails open
 *     when its backing store is unreachable has replaced one gap with a subtler
 *     one; this cannot be unreachable.
 *   - It is PER PROCESS. Across N instances the effective limit is N times the
 *     configured one. That is a real weakening under horizontal scale and is
 *     the reason the limits here are set well below what a human needs rather
 *     than just below what an attacker wants.
 *   - It resets on deploy. Acceptable: a deploy is not an attacker-controlled
 *     event.
 *
 * A shared-store limiter belongs with the deployment work in Phase 13, where
 * there is a known topology to size it against. Recorded in taskplans/66.
 *
 * WHAT THIS IS NOT. It is not a substitute for the provider's own limits.
 * Supabase applies throttling at its edge; this exists so the protection does
 * not disappear the moment Supabase is swapped for another provider in a
 * self-hosted deployment, which is exactly the case an enterprise customer
 * asks about.
 */

/** One fixed window's state for one key. */
type Window = { count: number; resetAt: number };

/**
 * Bounded so a flood of distinct keys cannot itself become the memory problem
 * the limiter exists to prevent. When the map is full the oldest windows are
 * dropped — an attacker who could force eviction still has to send more
 * distinct keys than this, and each eviction costs them more than it costs us.
 */
const MAX_KEYS = 10_000;

const windows = new Map<string, Window>();

export type RateLimitResult = {
  allowed: boolean;
  /** Attempts left in the current window. Zero when refused. */
  remaining: number;
  /** Seconds until the window resets. Meaningful only when refused. */
  retryAfterSeconds: number;
};

/**
 * Counts one attempt against `key` and says whether it may proceed.
 *
 * Fixed window rather than sliding: a sliding window needs per-request
 * timestamps and this needs to stay cheap enough to sit in front of every
 * sign-in without anyone weighing whether to skip it.
 */
export function rateLimit(
  key: string,
  options: { limit: number; windowSeconds: number },
): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_KEYS) {
      // Drop the entries nearest expiry first. Insertion order is a good enough
      // proxy and avoids sorting the whole map on a hot path.
      let dropped = 0;
      for (const candidate of windows.keys()) {
        windows.delete(candidate);
        if (++dropped >= MAX_KEYS / 10) break;
      }
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > options.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return {
    allowed: true,
    remaining: Math.max(0, options.limit - existing.count),
    retryAfterSeconds,
  };
}

/** Clears all windows. Test support only; never called by application code. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The sign-in limit.
 *
 * Ten attempts per five minutes per identifier. A person who has genuinely
 * forgotten their password makes three or four attempts and then resets it;
 * ten is comfortably above real use and far below what credential stuffing
 * needs to be worth running.
 */
export const SIGN_IN_LIMIT = { limit: 10, windowSeconds: 300 } as const;

/**
 * Keyed on the email address rather than on IP.
 *
 * An IP key is the wrong choice here in both directions: a corporate NAT puts
 * a whole office behind one address, so an IP limit locks out colleagues of
 * whoever mistyped a password, while an attacker with a proxy pool defeats it
 * for free. The account is the thing being attacked, so the account is what is
 * counted.
 *
 * Lower-cased so that casing variants are not ten free attempts each.
 */
export function signInKey(email: string): string {
  return `signin:${email.trim().toLowerCase()}`;
}
