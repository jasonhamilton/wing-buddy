/** F04 — extend the wing with another panel. */
import { expect, test } from "@playwright/test";
import { boot, expectClean, guard, openPanel, settled, statusBar, chooseMenu, addPanel } from "./helpers";

test.describe("F04 panels", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F04-H1 a new panel inherits the previous tip chord and airfoil", async ({ page }) => {
    await boot(page);
    await addPanel(page);
    await settled(page);
    await expect(page.getByRole("button", { name: "Edit Panel 3" })).toBeVisible();

    await openPanel(page, "Panel 3");
    // The outer panel tapers to 155mm, so the new root must start there.
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("155.00");
    await expectClean(errors);
  });

  test("F04-H2 panels reorder and the geometry follows", async ({ page }) => {
    await boot(page);
    const before = await statusBar(page).innerText();
    await page.getByRole("button", { name: "Reorder Outer panel" }).focus();
    await page.keyboard.press("ArrowUp");
    await settled(page);
    const names = (await page.getByRole("button", { name: /^Edit / }).allInnerTexts()).map((t) => t.trim());
    expect(names).toEqual(["Outer panel", "Inner panel"]);
    expect(await statusBar(page).innerText()).not.toBe(before);
    await expectClean(errors);
  });

  test("F04-E1 the last panel cannot be deleted", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Delete Outer panel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    await expect(page.getByRole("button", { name: "Delete Inner panel" })).toBeDisabled();
    await expectClean(errors);
  });

  test("F04-E2 deleting a panel asks first, and is still undoable afterwards", async ({ page }) => {
    await boot(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await page.getByRole("button", { name: "Delete Outer panel" }).click();
    await expect(page.getByRole("dialog", { name: "Delete Outer panel?" })).toBeVisible();
    await expect(statusBar(page)).toContainText("17 ribs"); // nothing happened yet
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("9 ribs");
    await chooseMenu(page, ["Edit", /^Undo/]);
    await settled(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await expectClean(errors);
  });

  test("F04-E3 a zero tip chord is refused, not rendered as a point", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    const tip = page.getByRole("spinbutton", { name: "Tip chord" });
    await tip.fill("0");
    await tip.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(/greater than 0/i);
    await expectClean(errors);
  });

  test("F04-E4 the summary sits under the panel cards on the one screen, with no view tabs", async ({ page }) => {
    await boot(page);
    await expect(page.getByRole("tab", { name: "Summary" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Planform" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Plane Definition" })).toHaveCount(0);
    await expect(page.locator("[data-panel-card]")).toHaveCount(2);
    const summary = page.getByLabel("Summary");
    await expect(summary).toContainText("Ribs to cut");
    // the cards scroll in their own area; the summary sits below that area
    const list = (await page.getByLabel("Panel list").boundingBox())!;
    expect((await summary.boundingBox())!.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
    await expectClean(errors);
  });
});

test.describe("F04 many panels and the view cube", () => {
  test("F04-S1 many panels scroll inside their own area; the cube snaps the camera", async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 8; i++) await addPanel(page);
    await expect(page.locator("[data-panel-card]")).toHaveCount(10);
    const list = page.getByLabel("Panel list");
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(page.getByLabel("Summary")).toBeInViewport();
    await expect(page.getByRole("group", { name: "View presets" })).toHaveCount(0);
    await page.getByRole("button", { name: "View from the top" }).click({ force: true });
    await expect(page.getByRole("group", { name: "View orientation" })).toBeVisible();
  });
});
