import { cookies } from "next/headers";
import { LABELS, LANG_COOKIE, isLang, type Labels, type Lang } from "./labels";

/** The language chosen on this device, remembered in a cookie. English until chosen. */
export async function getLang(): Promise<{ lang: Lang; t: Labels }> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  const lang: Lang = isLang(value) ? value : "en";
  return { lang, t: LABELS[lang] };
}
