// Proves every login of the local demo environment (scripts/demo-env.sh): signs in as each user through Keycloak with the shared
// password, then records where it lands, how many menu entries it has, and whether a screen only that role should reach opens.
//
//   node scripts/demo-env-verify.mjs [--base http://localhost:3000] [--password Demo-1234]
//
// Exit code 1 when any login fails to sign in or a role reaches (or is refused) a screen it should not.
import { chromium } from "@playwright/test";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const BASE = arg("base", "http://localhost:3000");
const PASSWORD = arg("password", "Demo-1234");

// username, a screen it must open, a screen it must be refused (or null)
const CHECKS = [
  ["dsew-owner", "/", null],
  ["dsew-supervisor", "/", "/accounting"],
  ["dsew-worker", "/", "/accounting"],
  ["stylified-owner", "/shopfloor/team", null],
  ["stylified-manager", "/shopfloor/approvals", null],
  ["stylified-supervisor-a", "/shopfloor", "/karigars"],
  ["stylified-supervisor-b", "/shopfloor/day-close", "/karigars"],
  ["stylified-munshi", "/lots/entry", null],
];

const REFUSED = /you do not have access|does not permit|not active|could not be found|This page could not load/i;
const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
let failed = 0;
const rows = [];

for (const [user, mustOpen, mustRefuse] of CHECKS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const row = { user, signedIn: false, menu: 0, opens: "-", refused: "-", note: "" };
  try {
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.getByText(/continue with organization sign-in/i).first().click();
    await page.waitForURL(/8080/);
    await page.fill("#username", user);
    await page.fill("#password", PASSWORD);
    await Promise.all([page.waitForURL(new RegExp(BASE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))), page.click("#kc-login")]);
    row.signedIn = !/\/sign-in/.test(page.url());
    await page.goto(`${BASE}${mustOpen}`, { waitUntil: "networkidle" });
    row.menu = await page.locator("nav a[href^='/']").count();
    const openedText = await page.innerText("body");
    row.opens = !REFUSED.test(openedText) && !/\/sign-in/.test(page.url()) ? "yes" : "NO";
    if (mustRefuse) {
      await page.goto(`${BASE}${mustRefuse}`, { waitUntil: "networkidle" });
      const refusedText = await page.innerText("body");
      row.refused = REFUSED.test(refusedText) ? "yes" : "NO";
    }
  } catch (error) {
    row.note = String(error.message).split("\n")[0].slice(0, 90);
  }
  if (!row.signedIn || row.opens === "NO" || row.refused === "NO" || row.note) failed += 1;
  rows.push(row);
  await ctx.close();
}
await browser.close();

console.log("\nuser".padEnd(26) + "signed in".padEnd(11) + "menu".padEnd(7) + "opens its screen".padEnd(18) + "refused the other".padEnd(19) + "note");
for (const r of rows) console.log(r.user.padEnd(25) + String(r.signedIn).padEnd(11) + String(r.menu).padEnd(7) + r.opens.padEnd(18) + r.refused.padEnd(19) + r.note);
console.log(failed ? `\n${failed} login(s) need attention` : "\nAll logins work.");
process.exit(failed ? 1 : 0);
