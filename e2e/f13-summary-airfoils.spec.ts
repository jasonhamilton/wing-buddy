/** The Summary shows both airfoils of every panel, and uploaded airfoils travel inside the project file. */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { boot, chooseMenu, expectClean, guard, openPanel, panelCard, settled } from "./helpers";

const summaryRow = panelCard;

async function exportProject(page: Page): Promise<Buffer> {
  const dl = page.waitForEvent("download");
  await chooseMenu(page, ["File", "Export", "Export Project"]);
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function importFoil(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser");
  await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
  await (await chooser).setFiles(file);
}

test.describe("Panel cards show root and tip airfoils", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("SU-H1 the panels table is gone; each panel is a card, and the cards never say Root or Tip", async ({ page }) => {
    await boot(page);
    await expect(page.getByRole("table")).toHaveCount(0);
    for (const n of ["Inner panel", "Outer panel"]) {
      await expect(panelCard(page, n)).toBeVisible();
      await expect(panelCard(page, n)).not.toContainText(/\b(root|tip)\b/i);
    }
    await expectClean(errors);
  });

  test("SU-H2 different root and tip sections are both named; a shared one says so", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0012");
    await page.getByRole("button", { name: /NACA 0012/ }).click();
    await page.getByRole("button", { name: "Done" }).click();

    const inner = summaryRow(page, "Inner panel");
    await expect(inner).toContainText("NACA 2412");
    await expect(inner).toContainText("NACA 0012");
    // Outer panel keeps one section at both ends: it is named once
    const outer = summaryRow(page, "Outer panel");
    await expect(outer.locator(".font-mono")).toHaveCount(1);
    await expect(outer.locator(".font-mono")).toContainText("NACA 2412");
    await expect(inner.locator(".font-mono")).toHaveCount(2);
    await expectClean(errors);
  });

  test("SU-H3 a thickness factor other than 1 is shown beside its section", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const f = page.getByRole("spinbutton", { name: "Tip thickness factor" });
    await f.fill("0.85");
    await f.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(summaryRow(page, "Inner panel")).toContainText("×0.85");
    await expect(summaryRow(page, "Outer panel")).not.toContainText("×");
    await expectClean(errors);
  });

  test("SU-E1 an imported section shows by name at the tip as well", async ({ page }) => {
    await boot(page);
    await importFoil(page, "seligdatfile.dat");
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("button", { name: /RG 14 AIRFOIL/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(summaryRow(page, "Inner panel")).toContainText("RG 14 AIRFOIL");
    await expectClean(errors);
  });

  test("SU-E3 aspect ratio is span squared over area in the same units: about 7.3 for the example wing", async ({ page }) => {
    await boot(page);
    const value = Number((await page.getByText("Aspect ratio", { exact: true }).locator("xpath=following-sibling::dd").innerText()).trim().split(/\s/)[0]);
    // 1555.5mm span = 15.555dm; area 33.18dm2; 15.555^2 / 33.18 = 7.29
    expect(value).toBeGreaterThan(7.2);
    expect(value).toBeLessThan(7.4);
    await expectClean(errors);
  });

  test("SU-E2 a long section name does not push the page sideways, at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await importFoil(page, {
      name: "long.dat",
      mimeType: "text/plain",
      buffer: Buffer.from(readFileSync("seligdatfile.dat", "utf8").replace("RG 14 AIRFOIL", "A very long airfoil name ".repeat(5))),
    });
    await openPanel(page, "Inner panel");
    await page.getByRole("button", { name: /A very long airfoil name/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });
});

test.describe("uploaded airfoils travel with the project", () => {
  test("AF-H1 upload, export, then open on a different computer: the airfoils are there and in use", async ({ browser }) => {
    test.setTimeout(90_000); // two browsers, two uploads, a file in between
    const errors: string[] = [];

    // --- computer one ---
    const one = await (await browser.newContext()).newPage();
    guard(one, errors);
    await boot(one);
    await importFoil(one, "seligdatfile.dat"); // goes in the list, unused
    await importFoil(one, {
      name: "second.dat",
      mimeType: "text/plain",
      buffer: Buffer.from(readFileSync("seligdatfile.dat", "utf8").replace("RG 14 AIRFOIL", "SECOND CUSTOM FOIL")),
    });
    await openPanel(one, "Inner panel");
    await one.getByRole("button", { name: /RG 14 AIRFOIL/ }).click(); // root of the inner panel uses one
    await one.getByRole("button", { name: "Done" }).click();
    const file = await exportProject(one);

    // the file itself carries both, whether or not a panel uses them
    const json = JSON.parse(file.toString("utf8"));
    expect(json.airfoils.map((a: { name: string }) => a.name).sort()).toEqual(["RG 14 AIRFOIL", "SECOND CUSTOM FOIL"]);
    for (const a of json.airfoils) expect(a.points.length).toBeGreaterThan(20);

    // --- computer two: a new browser context shares nothing with the first ---
    const ctx2 = await browser.newContext();
    const two = await ctx2.newPage();
    guard(two, errors);
    await boot(two);
    // the library on a fresh machine knows nothing about them
    await openPanel(two, "Inner panel");
    await expect(two.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveCount(0);
    await two.getByRole("button", { name: "Done" }).click();

    const chooser = two.waitForEvent("filechooser");
    await chooseMenu(two, ["File", /^Open/]);
    await (await chooser).setFiles({ name: "wing.wingbuddy.json", mimeType: "application/json", buffer: file });
    await two.getByRole("button", { name: /Replace and load/ }).click();
    await settled(two);

    // the one in use still drives the ribs, and the unused one is still on offer
    await openPanel(two, "Inner panel");
    await expect(two.locator("label", { hasText: "Root section:" }).locator("xpath=following-sibling::div[1]")).toContainText("RG 14 AIRFOIL");
    await expect(two.getByRole("button", { name: /RG 14 AIRFOIL/ })).toBeVisible();
    await expect(two.getByRole("button", { name: /SECOND CUSTOM FOIL/ })).toBeVisible();
    // and can be picked for something else
    await two.getByRole("radio", { name: "Tip rib" }).check();
    await two.getByRole("button", { name: /SECOND CUSTOM FOIL/ }).click();
    await two.getByRole("button", { name: "Done" }).click();
    await expect(summaryRow(two, "Inner panel")).toContainText("RG 14 AIRFOIL");
    await expect(summaryRow(two, "Inner panel")).toContainText("SECOND CUSTOM FOIL");

    // uploading the same file again on computer two is recognised, not listed twice
    await importFoil(two, "seligdatfile.dat");
    await expect(two.locator("body")).toContainText(/already in this project/);
    await openPanel(two, "Inner panel");
    await expect(two.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveCount(1);
    await expectClean(errors);
    await ctx2.close();
  });

  test("AF-E1 airfoils uploaded to an empty project survive Export then New then Open", async ({ page }) => {
    const errors: string[] = [];
    guard(page, errors);
    await boot(page);
    await importFoil(page, "seligdatfile.dat");
    const file = await exportProject(page);
    await chooseMenu(page, ["File", /^New/]);
    await page.getByRole("button", { name: /Delete this project and start new/ }).click();
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveCount(0); // New starts without it
    await page.getByRole("button", { name: "Done" }).click();
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", /^Open/]);
    await (await chooser).setFiles({ name: "x.wingbuddy.json", mimeType: "application/json", buffer: file });
    await page.getByRole("button", { name: /Replace and load/ }).click();
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("button", { name: /RG 14 AIRFOIL/ })).toBeVisible();
    await expectClean(errors);
  });
});
