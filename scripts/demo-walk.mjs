// Demo route walk (Task 129 C2): opens every navigation route of a signed-in demo tenant at desktop and phone width, in light and
// dark, and records what a buyer would see go wrong. It reads only; it never submits a form or presses a button.
//
//   node scripts/demo-walk.mjs --base https://host --state session.json --tenant "DSEW demo" [--widths 1280,390] [--themes light,dark]
//        [--routes /a,/b | auto] [--out docs/demo/evidence] [--resolve host=ip] [--insecure]
//
// --state is a Playwright storage state for a signed-in person of that tenant (the saved session holds cookies: delete the file
// afterwards and never commit it). --routes auto reads every static `href: "/..."` a capability contributes to navigation.
//
// A route FAILS the walk on: HTTP 4xx/5xx, an uncaught page error, a console error, sideways scrolling (the page is wider than the
// viewport), or a glass card whose content is wider than the card. A page that says the person lacks access is recorded as FORBIDDEN,
// not as a failure: it means this login cannot see the screen, which the walk cannot judge.
//
// Exit code 1 when any route fails, so a pipeline can gate on it. Output: one screenshot per route/width/theme and a markdown table.

import { chromium } from "playwright";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
}

export function routesFromSources(root = "src/server/capabilities") {
  const found = new Set();
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const index = join(root, dir.name, "index.ts");
    let text;
    try {
      text = readFileSync(index, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/href:\s*"(\/[^"?#]*)"/g)) {
      const href = match[1];
      if (!href.includes("[") && !href.includes(":")) found.add(href);
    }
  }
  return [...found].sort();
}

/** Pure, so it is testable: classifies one visit from what the page reported. */
export function judge({ status, pageErrors, consoleErrors, overflowX, clippedCards, bodyText }) {
  const problems = [];
  if (status >= 400) problems.push(`HTTP ${status}`);
  if (pageErrors.length) problems.push(`page error: ${pageErrors[0].slice(0, 80)}`);
  if (consoleErrors.length) problems.push(`console error: ${consoleErrors[0].slice(0, 80)}`);
  if (overflowX > 1) problems.push(`scrolls sideways by ${overflowX}px`);
  if (clippedCards > 0) problems.push(`${clippedCards} card(s) clip their content`);
  if (problems.length) return { result: "FAIL", problems };
  if (/you do not have access|does not permit/i.test(bodyText)) return { result: "FORBIDDEN", problems: [] };
  return { result: "ok", problems: [] };
}

async function main() {
  const base = arg("base");
  const state = arg("state");
  if (!base || !state) throw new Error("usage: demo-walk.mjs --base <url> --state <storage-state.json> [--tenant name] [--routes auto]");
  const widths = String(arg("widths", "1280,390")).split(",").map(Number);
  const themes = String(arg("themes", "light,dark")).split(",");
  const out = String(arg("out", "docs/demo/evidence"));
  const tenant = String(arg("tenant", "unnamed tenant"));
  const routesArg = String(arg("routes", "auto"));
  const routes = routesArg === "auto" ? routesFromSources() : routesArg.split(",");
  const resolve = arg("resolve", "");
  const args = resolve ? [`--host-resolver-rules=${String(resolve).split(",").map((r) => { const [h, ip] = r.split("="); return `MAP ${h} ${ip}`; }).join(",")}`] : [];

  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args });
  const rows = [];
  let failures = 0;

  for (const width of widths) {
    for (const theme of themes) {
      const context = await browser.newContext({
        storageState: String(state),
        ignoreHTTPSErrors: Boolean(arg("insecure", false)),
        viewport: { width, height: width < 600 ? 844 : 800 },
        deviceScaleFactor: 1,
        isMobile: width < 600,
        colorScheme: theme,
      });
      await context.addCookies([{ name: "verity-theme", value: theme, url: String(base) }]);
      for (const route of routes) {
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
        page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
        let status = 0;
        try {
          const response = await page.goto(new URL(route, String(base)).toString(), { waitUntil: "networkidle", timeout: 45000 });
          status = response?.status() ?? 0;
        } catch (error) {
          pageErrors.push(`navigation: ${String(error.message).slice(0, 80)}`);
        }
        const facts = await page.evaluate(() => ({
          overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          // Content wider than its card is a defect whether the card hides it (clipped) or lets it spill out (overflowing).
          clippedCards: [...document.querySelectorAll(".glass-card")].filter((el) => el.scrollWidth > el.clientWidth + 2).length,
          bodyText: document.body?.innerText?.slice(0, 2000) ?? "",
        })).catch(() => ({ overflowX: 0, clippedCards: 0, bodyText: "" }));
        const verdict = judge({ status, pageErrors, consoleErrors, ...facts });
        const slug = `${route.replace(/\W+/g, "_") || "root"}-${width}-${theme}`;
        await page.screenshot({ path: join(out, `${slug}.png`) }).catch(() => {});
        rows.push({ route, width, theme, ...verdict });
        if (verdict.result === "FAIL") failures += 1;
        await page.close();
      }
      await context.close();
    }
  }
  await browser.close();

  const date = new Date().toISOString().slice(0, 10);
  const table = [
    `# Demo walk: ${tenant} (${date})`,
    "",
    `Base: ${base}. Widths: ${widths.join(", ")}. Themes: ${themes.join(", ")}. Routes: ${routes.length}. Failures: ${failures}.`,
    "",
    "| Route | Width | Theme | Result | Problems |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.route} | ${r.width} | ${r.theme} | ${r.result} | ${r.problems.join("; ")} |`),
    "",
  ].join("\n");
  writeFileSync(join(out, `walk-${tenant.replace(/\W+/g, "-").toLowerCase()}-${date}.md`), table);
  console.log(table.split("\n").slice(0, 6).join("\n"));
  console.log(`${rows.filter((r) => r.result === "ok").length} ok, ${rows.filter((r) => r.result === "FORBIDDEN").length} forbidden, ${failures} FAIL`);
  process.exitCode = failures > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(2); });
}
