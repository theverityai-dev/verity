import type { CSSProperties, ReactNode } from "react";
import { cookies } from "next/headers";
import { accentStyle, DEFAULT_ACCENT } from "@/server/platform/accent";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import { LiquidGlass } from "@/components/ui/LiquidGlass";
import "./globals.css";

/**
 * Inter and IBM Plex Mono, as specified on the identity board.
 *
 * Loaded through `next/font`, which self-hosts them at build time. The design
 * source links Google Fonts directly; doing that here would put a render-
 * blocking third-party request in front of an authenticated operational tool
 * and leak a request per session to a domain the platform does not control.
 *
 * The board prints its own weight ladder — Thin 100, Light 300, Regular 400,
 * Medium 500, Semibold 600 — and every one is used: Light carries the headings,
 * Regular the body, Medium the labels and controls, Semibold the primary button
 * and Heading 3.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["100", "300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata = {
  title: "Verity",
  description: "The operating backbone for modern businesses",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Never block zoom; some users need it and the layout does not depend on it.
  maximumScale: 5,
  themeColor: [
    // The design source's own `--base`. This is the colour the OS paints around
    // the viewport, so a mismatch shows as a seam at the top of a phone screen.
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

type Theme = "light" | "dark";

/**
 * Theme comes from a cookie so the server can stamp it into the first byte of
 * HTML. Accent is intentionally fixed to Apple system blue for this phase;
 * reintroduce user choice only with the later accent-picker scope.
 */
async function appearance(): Promise<{ theme?: Theme }> {
  const jar = await cookies();
  const t = jar.get("verity-theme")?.value;
  return {
    theme: t === "light" || t === "dark" ? t : undefined,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { theme } = await appearance();

  return (
    // The font variables go on <html>, not <body>. Tailwind v4 emits theme
    // variables onto :root, so a font variable scoped to body is invisible to
    // any rule that resolves against the root — which is how this shipped as
    // Times once already.
    //
    // `suppressHydrationWarning` is NOT about the theme — the server and client
    // now agree on `data-theme`, because it comes from a cookie both can see.
    // It is here because browser extensions rewrite the root element before
    // React hydrates: Dark Reader adds `data-darkreader-mode`,
    // `data-darkreader-scheme` and `data-darkreader-proxy-injected`, and
    // similar tools add their own. Those attributes are outside our control and
    // would otherwise report as a hydration mismatch on every load, for every
    // user running such an extension. This is the attribute's intended use.
    <html
      lang="en"
      data-theme={theme}
      // The custom properties carry the whole fixed-blue accent system. The 50→900 ladder
      // derives from the seed in CSS, so a change here repaints every accent
      // surface without a single component knowing it happened. `--color-accent-on`
      // is stamped because choosing it needs a contrast comparison CSS cannot do.
      style={accentStyle(DEFAULT_ACCENT) as CSSProperties}
      className={`${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Level 0. Fixed, behind everything, never interactive. */}
        <div className="verity-atmosphere" aria-hidden="true" />
        {/* Unblurred grain, on top of the atmosphere: dithers its gradient so
            it stays smooth at this size instead of banding. See globals.css. */}
        <div className="verity-grain" aria-hidden="true" />
        {/* Chromium-only refraction over the glass classes; no-op elsewhere. */}
        <LiquidGlass />
        {/* First stop for a keyboard user on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-3 focus:left-3 focus:bg-surface focus:text-text focus:px-4 focus:py-2 focus:rounded-md focus:border focus:border-line-strong focus:shadow-md"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
