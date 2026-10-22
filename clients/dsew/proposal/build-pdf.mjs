// Prints the DSEW proposal pack to PDF with the Verity document theme.
//   node clients/dsew/proposal/build-pdf.mjs
// Needs Playwright (already a dev dependency) and Microsoft Edge or Chrome installed. Fonts load from Google Fonts, so run online.
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "pdf");
const docs = [
  ["01-proposal", "01-Proposal"],
  ["02-delivery-and-deployment", "02-Delivery-and-Deployment"],
  ["03-licence-and-ownership", "03-Licence-and-Ownership"],
  ["04-company-and-platform", "04-Company-and-Platform"],
  ["05-technical-solution-document", "05-Technical-Solution-Document"],
];
// The recalculated edition is a single stand-alone document, printed separately from the package.
const recalculated = ["recalculated-proposal", "DSEW-Recalculated-Proposal"];

const footer = `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:7px;color:#6a6a72;padding:0 17mm;display:flex;justify-content:space-between;">
  <span>Verity by PlotArmour · D &amp; S Electric Works · Confidential draft</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

const section = (html, name) => html.match(new RegExp(`<!--DOC:${name}-->([\\s\\S]*?)<!--/DOC:${name}-->`))?.[1] ?? "";

async function launch() {
  for (const channel of ["msedge", "chrome", undefined]) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      /* try the next one */
    }
  }
  throw new Error("No browser found: install Microsoft Edge or Chrome, or run `npx playwright install chromium`.");
}

async function print(browser, url, file) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: footer });
  await page.close();
  console.log("wrote", path.relative(process.cwd(), file));
}

await mkdir(outDir, { recursive: true });
const browser = await launch();
try {
  for (const [src, name] of docs) await print(browser, pathToFileURL(path.join(dir, `${src}.html`)).href, path.join(outDir, `${name}.pdf`));

  const [rSrc, rName] = recalculated;
  await print(browser, pathToFileURL(path.join(dir, `${rSrc}.html`)).href, path.join(outDir, `${rName}.pdf`));

  // The combined package: every cover and body in order, one document.
  const parts = [];
  let extraStyle = "";
  for (const [src] of docs) {
    const html = await readFile(path.join(dir, `${src}.html`), "utf8");
    extraStyle += html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    parts.push(section(html, "cover"), section(html, "body"));
  }
  const pkg = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verity for D &amp; S Electric Works: proposal package</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="verity-doc.css"><style>${extraStyle} main { break-after: page; } main:last-of-type { break-after: auto; }</style></head><body>${parts.join("\n")}</body></html>`;
  const pkgFile = path.join(dir, "_package.html");
  await writeFile(pkgFile, pkg);
  await print(browser, pathToFileURL(pkgFile).href, path.join(outDir, "DSEW-Proposal-Package.pdf"));
} finally {
  await browser.close();
}
