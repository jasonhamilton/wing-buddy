/** File ▸ Sample plans: a list of ready-made wings; picking one replaces the project after asking. */
import { expect, test } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, guard, settled } from "./helpers";

const open = (page: import("@playwright/test").Page) => chooseMenu(page, ["File", /^Sample plans/]);

test.describe("Sample plans", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("SP-H1 the dialog lists each plane with its span and area", async ({ page }, info) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog", { name: "Sample plans" });
    const rows = dlg.getByRole("table", { name: "Sample plans" }).locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText("Allegro-Lite 2m");
    await expect(rows.first()).toContainText(/\d+mm/);
    await expect(rows.first()).toContainText(/dm²|dm2/);
    await expect(dlg.getByRole("button", { name: "Load plan" })).toBeDisabled();
    await a11y(page, info, "SP-H1-samples");
    await expectClean(errors);
  });

  test("SP-H2 picking a plane and loading asks first, then replaces the project", async ({ page }) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog", { name: "Sample plans" });
    await dlg.getByRole("button", { name: "Gentle Lady" }).click();
    await dlg.getByRole("button", { name: "Load plan" }).click();
    const ask = page.getByRole("dialog", { name: "Replace this project?" });
    await expect(ask).toContainText("Trainer 1200");
    await expect(ask).toContainText("Gentle Lady");
    await ask.getByRole("button", { name: "Replace and load" }).click();
    await settled(page);
    await expect(page).toHaveTitle("Wing Buddy - Gentle Lady");
    await expectClean(errors);
  });

  test("SP-E1 cancelling the question keeps the project; Escape closes the list", async ({ page }) => {
    await boot(page);
    await open(page);
    await page.getByRole("button", { name: "Aquila" }).click();
    await page.getByRole("button", { name: "Load plan" }).click();
    await page.getByRole("dialog", { name: "Replace this project?" }).getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveTitle("Wing Buddy - Trainer 1200");
    await open(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectClean(errors);
  });

  test("SP-E2 double-clicking a plane goes straight to the question", async ({ page }) => {
    await boot(page);
    await open(page);
    await page.getByRole("button", { name: "Olympic II" }).dblclick();
    await expect(page.getByRole("dialog", { name: "Replace this project?" })).toBeVisible();
    await expectClean(errors);
  });

  test("SP-E3 every sample opens, and has ribs", async ({ page }) => {
    await boot(page);
    for (const name of ["Allegro-Lite 2m", "Aquila", "Bird of Time", "Bubble Dancer", "Gentle Lady", "Olympic II"]) {
      await open(page);
      await page.getByRole("button", { name }).click();
      await page.getByRole("button", { name: "Load plan" }).click();
      await page.getByRole("button", { name: "Replace and load" }).click();
      await settled(page);
      await expect(page).toHaveTitle(`Wing Buddy - ${name}`);
      await expect(page.locator("footer[aria-label=Status]")).toContainText(/ribs/);
    }
    await expectClean(errors);
  });

  test("SP-E4 in inches the span and area are shown in inches", async ({ page }) => {
    await boot(page);
    await page.getByRole("radio", { name: "Inches" }).check({ force: true });
    await open(page);
    const first = page.getByRole("table", { name: "Sample plans" }).locator("tbody tr").first();
    await expect(first).toContainText(/\d+(\.\d+)?in/);
    await expect(first).not.toContainText("mm");
    await expectClean(errors);
  });

  test("SP-E6 on a desktop the window is twice the standard dialog width, and no plane name is cut off", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await open(page);
    const box = (await page.getByRole("dialog", { name: "Sample plans" }).boundingBox())!;
    await page.keyboard.press("Escape");
    await chooseMenu(page, ["File", /^New/]);
    const standard = (await page.getByRole("dialog", { name: "Start a new project?" }).boundingBox())!;
    await page.keyboard.press("Escape");
    expect(box.width).toBeGreaterThanOrEqual(standard.width * 2 - 2);
    await open(page);
    for (const name of ["Allegro-Lite 2m", "Bubble Dancer"]) {
      const b = page.getByRole("button", { name });
      expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await expectClean(errors);
  });

  test("SP-E5 it fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await open(page);
    await expect(page.getByRole("button", { name: "Aquila" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expectClean(errors);
  });
});
