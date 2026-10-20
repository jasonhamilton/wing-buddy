/** F03 — the spar action menu (S07d): right-click, keyboard, and the visible button. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, expectClean, guard, openPanel, chooseMenu } from "./helpers";

test.describe("F03 spar menu", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const toSpars = async (page: Page, panel = "Inner panel") => {
    await boot(page);
    await openPanel(page, panel);
    await page.getByRole("tab", { name: "Spars" }).click();
  };
  const dist = (page: Page) => page.getByRole("spinbutton", { name: "Distance from the datum edge" });
  // A submenu is named after the item that opened it, so match the one open menu by role.
  const menu = (page: Page) => page.getByRole("menu");

  test("F03-H8 right-clicking a spar row opens the menu and Duplicate adds a copy", async ({ page }, info) => {
    await toSpars(page);
    await page.getByRole("row", { name: /Wing joiner/ }).click({ button: "right" });
    await expect(menu(page)).toBeVisible();
    for (const n of ["Add in front", "Add behind", "Duplicate", "Delete", "Move to thickest point"]) {
      await expect(menu(page).getByRole("menuitem", { name: n })).toBeVisible();
    }
    await a11y(page, info, "F03-H8-spar-menu");
    await menu(page).getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(menu(page)).toBeHidden();
    await expect(page.getByRole("cell", { name: "Wing joiner copy" })).toBeVisible();
    await expectClean(errors);
  });

  test("F03-H9 keyboard only: the Spar actions button, arrows and Enter move a spar to the thickest point", async ({ page }) => {
    await toSpars(page);
    await dist(page).fill("70");
    await dist(page).press("Enter");
    await page.getByRole("button", { name: "Spar actions…" }).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    // Opening puts focus on the first item; walk down to the fifth.
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(menu(page).getByRole("menuitem", { name: "Move to thickest point" })).toBeFocused();
    await page.keyboard.press("Enter");
    const v = Number(await dist(page).inputValue());
    expect(v).toBeGreaterThan(25);
    expect(v).toBeLessThan(35);
    await expect(page.getByRole("button", { name: "Spar actions…" })).toBeFocused();
    await expectClean(errors);
  });

  test("F03-H10 the Menu key on a focused spar name opens it", async ({ page }) => {
    await toSpars(page);
    await page.getByRole("button", { name: "Wing joiner" }).focus();
    await page.keyboard.press("ContextMenu");
    await expect(menu(page)).toBeVisible();
    await expectClean(errors);
  });

  test("F03-E9 Escape closes only the menu; the dialog and the focus survive", async ({ page }) => {
    await toSpars(page);
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: /Wing panel definition/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spar actions…" })).toBeFocused();
    await expectClean(errors);
  });

  test("F03-E10 moving to the thickest point is one undo step", async ({ page }) => {
    await toSpars(page);
    await dist(page).fill("70");
    await dist(page).press("Enter");
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await menu(page).getByRole("menuitem", { name: "Move to thickest point" }).click();
    await expect(dist(page)).not.toHaveValue(/^70/);
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo/]);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await expect(dist(page)).toHaveValue(/^70/);
    await expectClean(errors);
  });

  test("F03-E11 matching a neighbour is unavailable on the first panel, with the reason", async ({ page }) => {
    await toSpars(page);
    await page.getByRole("button", { name: "Spar actions…" }).click();
    const prev = menu(page).getByRole("menuitem", { name: "Match a spar in the previous panel" });
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await expect(prev).toContainText("no previous panel");
    // Pressing a disabled item must not close the menu or do anything.
    await prev.click({ force: true }); // Playwright treats aria-disabled as not actionable
    await expect(menu(page)).toBeVisible();
    await expectClean(errors);
  });

  test("F03-H11 matching the previous panel's spar copies its chordwise position", async ({ page }) => {
    await toSpars(page, "Outer panel");
    await dist(page).fill("55");
    await dist(page).press("Enter");
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await menu(page).getByRole("menuitem", { name: "Match a spar in the previous panel" }).click();
    await expect(menu(page).getByRole("menuitem", { name: "Back" })).toBeVisible();
    await menu(page).getByRole("menuitem", { name: "Main spar" }).click();
    await expect(menu(page)).toBeHidden();
    await expect(dist(page)).toHaveValue(/^28\.00/);
    await expectClean(errors);
  });

  test("F03-E12 Escape inside a submenu steps back to the list, not out of the dialog", async ({ page }) => {
    await toSpars(page, "Outer panel");
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await menu(page).getByRole("menuitem", { name: "Match a spar in the previous panel" }).click();
    await page.keyboard.press("Escape");
    await expect(menu(page).getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await expectClean(errors);
  });

  test("F03-E13 the menu stays inside the viewport however close to the edge it opens", async ({ page }) => {
    await toSpars(page);
    const vp = page.viewportSize()!;
    await page.getByRole("row", { name: /Main spar/ }).click({ button: "right" });
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await expectClean(errors);
  });

  test("F03-E14 clicking elsewhere dismisses the menu", async ({ page }) => {
    await toSpars(page);
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await page.getByRole("tab", { name: "Ribs" }).click();
    await expect(menu(page)).toBeHidden();
    await expectClean(errors);
  });

  test("F03-N2 Add in front and Add behind put the new spar on either side", async ({ page }) => {
    await toSpars(page);
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await menu(page).getByRole("menuitem", { name: "Add in front" }).click();
    await expect(dist(page)).toHaveValue(/^18\.00/);
    await page.getByRole("button", { name: "Spar actions…" }).click();
    await menu(page).getByRole("menuitem", { name: "Add behind" }).click();
    await expect(dist(page)).toHaveValue(/^28\.00/);
    await expectClean(errors);
  });
});
