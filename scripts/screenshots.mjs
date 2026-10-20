// Regenerates docs/screenshots from a running preview: npm run build && npx vite preview --port 4317, then node scripts/screenshots.mjs
import { chromium } from "playwright";

const OUT = import.meta.dirname + "/../docs/screenshots";
const URL = process.env.URL ?? "http://localhost:4317/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { await wait(700); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("shot", name); };

await page.goto(URL, { waitUntil: "networkidle" });
await wait(1500);
await page.getByRole("button", { name: "File" }).click();
await page.getByRole("menuitem", { name: /^Sample plans/ }).click();
const dlg = page.getByRole("dialog", { name: "Sample plans" });
await shot("00-samples");
await dlg.getByRole("button", { name: "Gentle Lady" }).click();
await dlg.getByRole("button", { name: "Load plan" }).click();
await page.getByRole("button", { name: "Replace and load" }).click();
await wait(2500);
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Close" }).first().click({ timeout: 1500 }).catch(() => {});
await wait(5500); // let the toast go
await shot("01-overview");

const step = async (name, fn) => { try { await fn(); await shot(name); } catch (e) { console.log("FAILED", name, String(e).split("\n")[0]); } };
const closeDlg = async () => { await page.keyboard.press("Escape"); await wait(400); };

await step("02-cross-section", async () => {
  await page.getByRole("button", { name: "Cross Section View" }).click();
});
await page.getByRole("button", { name: /Cross Section View|3D View|Back/ }).first().click().catch(() => {});
await wait(500);

// The panel builder: geometry first, then the features and their details.
await page.getByRole("button", { name: "Edit Inboard panel" }).click();
await wait(1200);
await shot("03-builder-geometry");
await page.getByRole("button", { name: "Features", exact: true }).click();
await wait(900);
await shot("04-builder-features");
await step("06-add-feature", async () => {
  await page.getByRole("navigation", { name: "Features" }).getByRole("button", { name: "Add a feature" }).click();
});
await closeDlg();

await step("09-export-dxf", async () => {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /^Export DXF/ }).click();
});
await closeDlg();
await step("10-export-pdf", async () => {
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /^Export PDF/ }).click();
});
await closeDlg();
await step("11-dark", async () => {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
});
await browser.close();
