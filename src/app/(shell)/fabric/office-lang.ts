import { getLang } from "../shopfloor/lang";
import { OFFICE_LABELS, type OfficeLabels } from "./office-labels";
import type { Lang } from "../shopfloor/labels";

/** The language chosen on this device (the floor's cookie) and the office labels in it. English until chosen. */
export async function getOfficeLang(): Promise<{ lang: Lang; o: OfficeLabels }> {
  const { lang } = await getLang();
  return { lang, o: OFFICE_LABELS[lang] };
}
