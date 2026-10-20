/** F02 — shape the ribs. */
import { expect, test } from "@playwright/test";
import { a11y, boot, expectClean, guard, openPanel, settled, statusBar, chooseMenu, ribCell, ribEdit, ribText } from "./helpers";

/** The rib table is edited in a Custom layout: choose Custom, which keeps the ribs as they are, and take thickness and half ribs too. */
const customise = async (page: import("@playwright/test").Page) => {
  await page.getByRole("combobox", { name: "Rib distribution" }).selectOption("custom");
  await page.getByRole("checkbox", { name: /Set each rib's thickness/ }).check();
  await page.getByRole("button", { name: "Advanced", exact: true }).click(); // half ribs are in the Advanced section above the table
  await page.getByRole("checkbox", { name: "Half ribs", exact: true }).check();
};

test.describe("F02 ribs", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F02-H1 generate ribs and preview one", async ({ page }, info) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("spinbutton", { name: "Rib thickness" }).fill("2.5");
    await page.getByRole("spinbutton", { name: "Rib thickness" }).press("Enter");
    await page.getByRole("spinbutton", { name: "Number of ribs" }).fill("13");
    await page.getByRole("spinbutton", { name: "Number of ribs" }).press("Enter");
    await expect(page.getByRole("button", { name: "R13", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "R7", exact: true }).click();
    await expect(page.getByRole("img", { name: /Rib outline: Rib 7/ })).toBeVisible();

    await a11y(page, info, "F02-H1-ribs-tab");
    await expectClean(errors);
  });

  test("F02-E1 two ribs is the floor; one is refused", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    const count = page.getByRole("spinbutton", { name: "Number of ribs" });
    await count.fill("1");
    await count.press("Enter");
    await expect(count).toHaveValue("2");
    await expect(page.getByRole("button", { name: "R2", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "R3", exact: true })).toHaveCount(0);
    await expectClean(errors);
  });

  test("F02-E2 an absurd rib count warns before it is applied", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    const count = page.getByRole("spinbutton", { name: "Number of ribs" });
    await count.fill("190");
    await count.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(/between ribs/i);
    await expectClean(errors);
  });

  test("F02-E3 the rib count is capped so the app cannot be hung", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    const count = page.getByRole("spinbutton", { name: "Number of ribs" });
    await count.fill("99999");
    await count.press("Enter");
    await expect(count).toHaveValue("200");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expectClean(errors);
  });

  test("F02-E4 changing the rib count keeps the spars attached", async ({ page }) => {
    // Regenerating ribs must never orphan a spar.
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("spinbutton", { name: "Number of ribs" }).fill("15");
    await page.getByRole("spinbutton", { name: "Number of ribs" }).press("Enter");

    await page.getByRole("tab", { name: "Spars" }).click();
    await page.getByRole("cell", { name: "Main spar" }).click();
    await expect(page.getByRole("dialog")).toContainText("Ribs 1 – 15");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).not.toContainText("error");
    await expectClean(errors);
  });

  test("F02-E5 undo restores the previous rib set", async ({ page }) => {
    await boot(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("spinbutton", { name: "Number of ribs" }).fill("20");
    await page.getByRole("spinbutton", { name: "Number of ribs" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("28 ribs");

    await chooseMenu(page, ["Edit", /^Undo/]);
    await settled(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await expectClean(errors);
  });
});

test.describe("F02 rib table editing", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const toRibs = async (page: import("@playwright/test").Page) => {
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await customise(page);
  };

  test("F02-H2 a rib station can be typed and the geometry follows", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await expect(ribCell(page, "Rib 3 position")).toContainText("105.00");
    await ribEdit(page, "Rib 3 position", "140");
    await expect(ribCell(page, "Rib 3 position")).toContainText("140.00");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await expectClean(errors);
  });

  test("F02-H3 a rib thickness can be typed", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribEdit(page, "Rib 2 thickness", "5");
    await expect(ribCell(page, "Rib 2 thickness")).toContainText("5.00");
    await expectClean(errors);
  });

  test("F02-H4 ribs can be added and deleted", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await expect(page.getByRole("dialog")).toContainText(/Rib table\s*\(9 ribs\)/);
    await page.getByRole("button", { name: "Add rib" }).click();
    await expect(page.getByRole("dialog")).toContainText(/Rib table\s*\(10 ribs\)/);
    await page.getByRole("button", { name: "Delete rib" }).click();
    await expect(page.getByRole("dialog")).toContainText(/Rib table\s*\(9 ribs\)/);
    await expectClean(errors);
  });

  test("F02-E6 a station outside the panel is clamped, and the table re-sorts", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    const positions = async () =>
      Promise.all(
        (await page.getByRole("button", { name: /^Change Rib \d+ position$/ }).all()).map(async (b) => parseFloat(await b.innerText())),
      );

    await ribEdit(page, "Rib 4 position", "9000");
    let all = (await positions()).map(Number);
    // Clamped to the panel length, and now the last station because the table
    // is ordered by position.
    expect(Math.max(...all)).toBe(420);
    expect(all[all.length - 1]).toBe(420);
    expect(all).toEqual([...all].sort((a, b) => a - b));

    await ribEdit(page, "Rib 5 position", "-10");
    all = (await positions()).map(Number);
    expect(Math.min(...all)).toBe(0);
    expect(all).toEqual([...all].sort((a, b) => a - b));
    await expectClean(errors);
  });

  test("F02-E7 overlapping ribs are reported, not silently built", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribEdit(page, "Rib 2 position", "52.6");
    await ribEdit(page, "Rib 3 position", "53");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.locator("body")).toContainText(/they overlap/i);
    await expectClean(errors);
  });

  test("F02-E8 the last two ribs cannot be deleted away", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    const count = page.getByRole("spinbutton", { name: "Number of ribs" });
    await count.fill("2");
    await count.press("Enter");
    await customise(page);
    await expect(page.getByRole("dialog")).toContainText(/Rib table\s*\(2 ribs\)/);
    await expect(page.getByRole("button", { name: "Delete rib" })).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText(/at least two ribs/i);
    await expectClean(errors);
  });
});
