/**
 * Sign-in by username, for people who have no email (a floor supervisor, a munshi). There is one sign-in method, the Supabase
 * email and password; a username is only a shorthand for an address on a reserved domain that no mailbox can ever own.
 * Typing `ravi.stylified` signs in as `ravi.stylified@login.verity.local`. A real email is used exactly as typed.
 *
 * The domain is shared by every client, so a username is unique across Verity, not within one business. The Team screen says so
 * and suggests adding the business name (`ravi.stylified`). Nothing is ever emailed to such an address: a forgotten password is
 * reset by the owner on the Team screen.
 */
export const LOGIN_DOMAIN = "login.verity.local";

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** True for something that can be a username (no @, 3 to 32 of letters, digits, dot, dash, underscore). */
export const isUsername = (input: string): boolean => USERNAME.test(input.trim().toLowerCase());

/** The address to sign in or create an account with: a typed email as is, a username on the reserved domain, or null if it is neither. */
export function loginAddress(input: string): string | null {
  const typed = input.trim().toLowerCase();
  if (typed.includes("@")) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed) ? typed : null;
  return isUsername(typed) ? `${typed}@${LOGIN_DOMAIN}` : null;
}

/** What to show for an address on the reserved domain: the username the person actually types. */
export const loginLabel = (address: string | null): string | null =>
  address && address.endsWith(`@${LOGIN_DOMAIN}`) ? address.slice(0, -(LOGIN_DOMAIN.length + 1)) : address;
