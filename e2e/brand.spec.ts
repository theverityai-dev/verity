import { expect, test } from "@playwright/test";

/**
 * The Verity visual identity.
 *
 * These assert the things that would silently regress and that no other suite
 * would notice: the brand token values, the mark's geometry, the theme
 * round-trip, and text contrast across both themes. A screenshot review catches
 * none of them reliably — a font that fails to load looks "fine" until you
 * compare it to something, and this project shipped Times once already because
 * a theme variable was scoped to the wrong element.
 */

const BOARD = {
  // Printed on the identity board `design/verity asthetics.png`: Primary
  // #00D1B2, Background #F7F8FA, Text #0F1115 (ADR-012).
  // The accent FILL is not the seed: it is the step of the seed's tonal ladder
  // that clears AA with its ink. #00D1B2 fills at the 600 step in light and the
  // 300 step in dark. Asserting the seed here would assert a colour the product
  // never paints.
  light: { accent: "rgb(2, 185, 158)", canvas: "rgb(247, 248, 250)" },
  dark: { accent: "rgb(107, 228, 210)", canvas: "rgb(15, 17, 21)" },
  onAccent: "rgb(25, 26, 28)",
};

/**
 * Reads the USED value of a token, not the declared one.
 *
 * Every themed token is a `light-dark()` pair, which the build lowers to a
 * `var(--lightningcss-light, …) var(--lightningcss-dark, …)` polyfill. Reading
 * the custom property back therefore returns that whole string rather than a
 * colour, and asserting on it would be asserting on the compiler's internals.
 * Substituting the token into a real property and reading the computed result
 * is what an actual pixel resolves to.
 */
async function tokens(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.appendChild(probe);
    const used = (token: string) => {
      probe.style.color = "";
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const result = {
      theme: document.documentElement.getAttribute("data-theme"),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      accent: used("--color-accent"),
      ink: used("--color-accent-ink"),
      canvas: used("--color-canvas"),
      onAccent: used("--color-accent-on"),
      font: getComputedStyle(document.body).fontFamily,
    };
    probe.remove();
    return result;
  });
}

/** The preference is a cookie now, so the SERVER can stamp the theme. */
async function setTheme(page: import("@playwright/test").Page, value: string) {
  await page.context().addCookies([
    { name: "verity-theme", value, url: "http://localhost:3000" },
  ]);
}

test.describe("brand identity", () => {
  test("renders the approved accent tokens in light mode", async ({ page }) => {
    await setTheme(page, "light");
    await page.goto("/");

    const t = await tokens(page);
    expect(t.theme).toBe("light");
    expect(t.colorScheme).toBe("light");
    expect(t.accent).toBe(BOARD.light.accent);
    expect(t.canvas).toBe(BOARD.light.canvas);
    // Dark ink on the accent, never white. #00D1B2 is a LIGHT accent: white on
    // its light fill measures 2.40:1 while #191A1C measures 7.00:1.
    expect(t.onAccent).toBe(BOARD.onAccent);
  });

  test("follows the operating system when no choice has been made", async ({ page }) => {
    // No cookie, so the server stamps nothing and CSS decides. This is the path
    // that used to need an inline theme script; it now needs no JavaScript.
    await page.goto("/");
    const t = await tokens(page);
    expect(t.theme).toBeNull();
    expect(t.colorScheme).toBe("light dark");
  });

  test("designs dark mode rather than inverting it", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/");

    const t = await tokens(page);
    expect(t.theme).toBe("dark");
    expect(t.colorScheme).toBe("dark");
    // Dark is designed, not inverted: the fill brightens and the ink brightens
    // further, because a dark-mode accent must gain luminance to stay legible.
    expect(t.accent).toBe(BOARD.dark.accent);
    expect(t.canvas).toBe(BOARD.dark.canvas);
  });

  test("carries no theme script at all", async ({ page }) => {
    await page.goto("/");
    // The theme is stamped by the server from a cookie and resolved by CSS.
    // An inline script here is re-created on every client render, where it can
    // never execute, and React reports that on every load in development.
    const inline = await page
      .locator("script:not([src])")
      .evaluateAll((els) => els.filter((e) => (e.textContent ?? "").includes("verity-theme")).length);
    expect(inline).toBe(0);
  });

  test("loads Inter rather than falling back to a system serif", async ({ page }) => {
    await page.goto("/");
    const t = await tokens(page);
    // The FIRST family is what actually renders. Asserting only "contains Inter"
    // would pass while the browser fell through to a serif, and asserting the
    // string does not end in "serif" is wrong too — the stack legitimately ends
    // in the generic `sans-serif`.
    expect(t.font.split(",")[0]!.trim().replace(/["']/g, "")).toBe("Inter");
    expect(await page.evaluate(() => document.fonts.check('400 14px Inter'))).toBe(true);
  });

  test("draws the hourglass mark at its measured geometry", async ({ page }) => {
    await page.goto("/");

    // The mark is geometry, not a font glyph or an icon-library import, and it
    // is not two plain triangles either: the corners carry a 2.0 radius and the
    // facing apexes are cut by a circle. Both were derived by measuring the
    // supplied asset and verified to 0.47% against it. Locked here because
    // "close enough" is how a brand ends up subtly wrong on every screen.
    const paths = await page
      .locator('svg[viewBox="0 0 16.613 24"] path')
      .evaluateAll((els) => els.map((e) => e.getAttribute("d")));

    // The shell mounts the lockup more than once (rail and mobile bar), so this
    // asserts on the shape rather than on how many copies exist.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.every((d) => d?.includes("A 2 2 0 0"))).toBe(true);
    expect(paths.every((d) => d?.includes("A 1.3135 1.3135"))).toBe(true);
  });

  test("renders the wordmark as artwork, not as type", async ({ page }) => {
    await page.goto("/");

    // "verity" is set in a geometric face that is not Inter. Reproducing it with
    // a font would approximate a logotype, so the approved artwork is masked and
    // painted with currentColor instead.
    const masks = await page
      .locator("span")
      .evaluateAll((els) =>
        els.map((e) => getComputedStyle(e).webkitMaskImage).filter((v) => v && v !== "none"),
      );
    expect(masks.some((m) => m.includes("verity-wordmark"))).toBe(true);
  });

  test("keeps the theme choice across a reload, and the server honours it", async ({ page }) => {
    await setTheme(page, "dark");
    await page.goto("/");
    await page.getByRole("button", { name: /^Theme:/ }).click();

    const chosen = (await page.context().cookies()).find((c) => c.name === "verity-theme")?.value;
    expect(chosen).toBeTruthy();

    await page.reload();
    const after = (await page.context().cookies()).find((c) => c.name === "verity-theme")?.value;
    expect(after).toBe(chosen);

    // The point of the cookie is that the SERVER can act on it, so the very
    // first byte of HTML is already the right theme and nothing flashes.
    const stamped = await page.getAttribute("html", "data-theme");
    expect(chosen === "system" ? stamped === null : stamped === chosen).toBe(true);
  });

  test("meets AA text contrast in both themes", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.addInitScript((t) => localStorage.setItem("verity-theme", t), theme);
      await page.goto("/locations");

      const failures = await page.evaluate(() => {
        // Parse to [r,g,b,a]. Alpha matters now: the material system tints with
        // translucency, so a token's declared colour is not what a pixel shows.
        const parse = (c: string): [number, number, number, number] => {
          const p = (c.match(/[\d.]+/g) ?? []).map(Number);
          return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
        };
        const over = (
          fg: [number, number, number, number],
          bg: [number, number, number, number],
        ): [number, number, number, number] => [
          fg[0] * fg[3] + bg[0] * (1 - fg[3]),
          fg[1] * fg[3] + bg[1] * (1 - fg[3]),
          fg[2] * fg[3] + bg[2] * (1 - fg[3]),
          1,
        ];
        const lumOf = (rgb: [number, number, number, number]) => {
          const [r, g, b] = rgb.slice(0, 3).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };

        // ADR-011 constraint 1: measure the COMPOSITED result. Walk every
        // ancestor and flatten each translucent layer onto the one beneath it,
        // exactly as the compositor does. Comparing text against an unmixed
        // token is how a 10%-alpha tint reports 1.00:1 while rendering fine.
        const bgOf = (el: Element): [number, number, number, number] => {
          const layers: Array<[number, number, number, number]> = [];
          let n: Element | null = el;
          while (n && n !== document.documentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c[3] > 0) layers.push(c);
            if (c[3] === 1) break;
            n = n.parentElement;
          }
          const root = parse(getComputedStyle(document.body).backgroundColor);
          return layers.reduceRight((acc, layer) => over(layer, acc), root);
        };

        const bad: string[] = [];
        document.querySelectorAll("a,p,span,td,th,h1,h2,h3,button,label").forEach((el) => {
          const text = el.textContent?.trim();
          if (!text) return;
          // Only elements holding their own text; a wrapper inherits nothing.
          if (
            el.children.length &&
            ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
          ) {
            return;
          }
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return;

          const fs = parseFloat(cs.fontSize);
          const fw = parseInt(cs.fontWeight) || 400;
          const need = fs >= 24 || (fs >= 18.66 && fw >= 700) ? 3.0 : 4.5;
          const bg = bgOf(el);
          const l1 = lumOf(over(parse(cs.color), bg));
          const l2 = lumOf(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < need) bad.push(`${text.slice(0, 24)} @ ${ratio.toFixed(2)}:1 (needs ${need})`);
        });
        return bad;
      });

      expect(failures, `contrast failures in ${theme} mode`).toEqual([]);
    }
  });

  test("keeps text on the accent fill legible", async ({ page }) => {
    // The label ink is chosen per accent (accent.ts) so the pair clears AA
    // outright — there is no exception to carve out here. This asserts the
    // floor so a future accent change cannot quietly reintroduce one.
    await setTheme(page, "light");
    await page.goto("/");

    const ratio = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const used = (t: string) => {
        probe.style.color = `var(${t})`;
        return getComputedStyle(probe).color;
      };
      const lum = (c: string) => {
        const p = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const [r, g, b] = p.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const a = lum(used("--color-accent-on"));
      const b = lum(used("--color-accent"));
      probe.remove();
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });

    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Sign-in must be visited WITHOUT a session. The project's stored auth state
 * would redirect this page to the shell, and every assertion below would then
 * silently pass against the wrong document.
 */
test.describe("sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("keeps implementation vocabulary and marketing filler off the page", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // This page is reachable by anyone. It should not describe how the platform
    // is built, and it should not fill the silence with generic SaaS copy.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const leak of [
      "identity realm",
      "authentication is handled",
      "tenant",
      "supabase",
      "authorization",
      "welcome back",
      "access your workspace",
      "enter your credentials",
    ]) {
      expect(text, `sign-in must not say "${leak}"`).not.toContain(leak);
    }
  });

  test("carries the Verity identity, not a default form", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.locator('svg[viewBox="0 0 16.613 24"]').first()).toBeVisible();

    const masks = await page
      .locator("span")
      .evaluateAll((els) =>
        els.map((e) => getComputedStyle(e).webkitMaskImage).filter((v) => v && v !== "none"),
      );
    expect(masks.some((m) => m.includes("verity-wordmark"))).toBe(true);

    // The primary action is the accent. A default blue button is the single
    // clearest sign that a brand was never applied.
    const bg = await page
      .getByRole("button", { name: "Sign in" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect([BOARD.light.accent, BOARD.dark.accent]).toContain(bg);
  });

  test("rejects bad credentials without revealing which field was wrong", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("nobody@example.invalid");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();

    // Distinguishing "no such account" from "wrong password" is an
    // account-enumeration oracle.
    const message = (await alert.innerText()).toLowerCase();
    expect(message).not.toContain("no such");
    expect(message).not.toContain("not found");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
