/** Checks: a problem with a known repair has a Fix button, which tries the repair and says what it did. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });
const checks = (page: Page) => page.getByRole("region", { name: "Summary" });

async function leadingEdge(page: Page, width: string, height?: string) {
  await openPanel(page, "Inner panel");
  await page.getByRole("tab", { name: "Leading Edge" }).click();
  const use = page.getByRole("checkbox", { name: /Use leading edge stock/ });
  if (!(await use.isChecked())) await use.check();
  await field(page, "Stock width").fill(width);
  await field(page, "Stock width").press("Enter");
  if (height) {
    await field(page, "Stock height").fill(height);
    await field(page, "Stock height").press("Enter");
  }
  await page.getByRole("button", { name: "Done" }).click();
  await settled(page);
}

test.describe("Fix on the checks", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("FX-H1 a clean wing has no Fix buttons", async ({ page }) => {
    await boot(page);
    await expect(checks(page)).toContainText("Nothing to flag");
    await expect(checks(page).getByRole("button", { name: /^Fix/ })).toHaveCount(0);
    await expectClean(errors);
  });

  test("FX-H2 an error with a repair shows Fix; pressing it clears the error and says what it did", async ({ page }, info) => {
    await boot(page);
    await leadingEdge(page, "600");
    await expect(checks(page)).toContainText("Nothing is left of this rib");
    const fix = checks(page).getByRole("button", { name: /^Fix: Nothing is left/ });
    await expect(fix).toBeVisible();
    await a11y(page, info, "FX-H2-checks-with-fix");
    await fix.click();
    await settled(page);
    await expect(checks(page)).not.toContainText("Nothing is left of this rib");
    await expect(checks(page).getByRole("status")).toContainText(/edge stock/i);
    const width = (await exportProjectJson(page)).wing.panels[0].leadingEdge.widthMm;
    expect(width).toBeLessThan(100);
    await expectClean(errors);
  });

  test("FX-H3 a warning with a repair is fixable too: edge stock too low is raised", async ({ page }) => {
    await boot(page);
    await leadingEdge(page, "10", "1");
    await expect(checks(page)).toContainText("too low to cover the airfoil");
    await checks(page).getByRole("button", { name: /^Fix: .*too low/ }).click();
    await settled(page);
    await expect(checks(page)).not.toContainText("too low to cover");
    expect((await exportProjectJson(page)).wing.panels[0].leadingEdge.heightMm).toBeGreaterThan(1);
    await expectClean(errors);
  });

  test("FX-E1 a fix is one undo step, and undo brings the problem back", async ({ page }) => {
    await boot(page);
    await leadingEdge(page, "10", "1");
    await checks(page).getByRole("button", { name: /^Fix: .*too low/ }).click();
    await chooseMenu(page, ["Edit", /^Undo fix check/]);
    await settled(page);
    await expect(checks(page)).toContainText("too low to cover the airfoil");
    await expectClean(errors);
  });

  test("FX-E2 a check with no known repair has no button", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await page.getByRole("button", { name: "Add spar" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    // whatever the checks say about the spar, only the repairable ones carry a button
    for (const li of await checks(page).locator("li").all()) {
      const text = (await li.innerText()).replace(/\s*Fix\s*$/, "");
      const hasButton = (await li.getByRole("button", { name: /^Fix/ }).count()) > 0;
      expect(hasButton, text).toBe(/too low to cover|Nothing is left|no ribs yet|overlap|airfoil could not|shrunk to zero/.test(text));
    }
    await expectClean(errors);
  });

  test("FX-E3 at phone width the button stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await leadingEdge(page, "10", "1");
    const fix = checks(page).getByRole("button", { name: /^Fix: .*too low/ });
    await fix.scrollIntoViewIfNeeded();
    await expect(fix).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expectClean(errors);
  });
});
