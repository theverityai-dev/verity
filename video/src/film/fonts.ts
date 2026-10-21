import { continueRender, delayRender, staticFile } from "remotion";

/**
 * Inter 5.2.8 (OFL-1.1), the product UI typeface, from `@fontsource/inter` copied into
 * `public/fonts`. Loaded before the first frame renders so no frame ever paints a fallback face.
 * The latin-ext files carry the rupee sign (U+20B9).
 */
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const WEIGHTS = [300, 400, 500, 600, 700] as const;

let started = false;

export function loadFonts(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading Inter");
  const faces = WEIGHTS.flatMap((w) => [
    new FontFace("Inter", `url(${staticFile(`fonts/inter-latin-${w}-normal.woff2`)}) format("woff2")`, {
      weight: String(w),
      unicodeRange: LATIN,
    }),
    new FontFace("Inter", `url(${staticFile(`fonts/inter-latin-ext-${w}-normal.woff2`)}) format("woff2")`, {
      weight: String(w),
      unicodeRange: LATIN_EXT,
    }),
  ]);
  Promise.all(faces.map((f) => f.load()))
    .then((loaded) => {
      loaded.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    })
    .catch((err) => {
      // A missing font must fail the render, not quietly fall back to Segoe UI.
      throw err;
    });
}
