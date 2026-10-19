/**
 * A post-sign-in destination must stay on this site. Only a rooted path is accepted: a leading `//` or `/\` is read
 * by browsers as another host, and a control character could split a header, so each falls back to the home page.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || value.length > 512 || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  return value;
}
