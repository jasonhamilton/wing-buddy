/** The panel list on Plane Definition: a small + to add, a drag handle to reorder, a trash button to delete (after asking). */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, guard, openPanel, panelCard, settled, statusBar, addPanel } from "./helpers";

const order = async (page: Page) => (await page.getByRole("button", { name: /^Edit / }).allInnerTexts()).map((t) => t.trim());
const handle = (page: Page, name: string) => page.getByRole("button", { name: `Reorder ${name}` });
const trash = (page: Page, name: string) => page.getByRole("button", { name: `Delete ${name}` });

async function dragHandle(page: Page, from: string, toRowName: string, where: "above" | "below" = "above", release = true) {
  const h = (await handle(page, from).boundingBox())!;
  const target = (await panelCard(page, toRowName).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  const y = where === "above" ? target.y + 3 : target.y + target.height - 3;
  await page.mouse.move(h.x + h.width / 2, (h.y + y) / 2, { steps: 4 });
  await page.mouse.move(h.x + h.width / 2, y, { steps: 6 });
  if (release) await page.mouse.up();
}

test.describe("panel list", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("PL-H1 Move up, Move down, Edit panel and Delete panel are gone; Add panel is a small + button", async ({ page }) => {
    await boot(page);
    for (const n of ["Move up", "Move down", "Edit panel", "Delete panel"]) {
      await expect(page.getByRole("button", { name: n, exact: true })).toHaveCount(0);
    }
    const add = page.getByRole("button", { name: "Add panel", exact: true });
    await expect(add).toBeVisible();
    await expect(add).toHaveText("+");
    const box = (await add.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(40);
    expect(box.height).toBeLessThanOrEqual(40);
    await addPanel(page);
    await settled(page);
    expect(await order(page)).toEqual(["Inner panel", "Outer panel", "Panel 3"]);
    await expectClean(errors);
  });

  test("PL-H2 every panel row has a drag handle and a trash button, each named for its panel", async ({ page }) => {
    await boot(page);
    for (const n of ["Inner panel", "Outer panel"]) {
      await expect(handle(page, n)).toBeVisible();
      await expect(trash(page, n)).toBeVisible();
    }
    await expectClean(errors);
  });

  test("PL-H3 dragging a handle reorders the panels, and the geometry follows; Undo puts it back in one step", async ({ page }) => {
    await boot(page);
    const before = await statusBar(page).innerText();
    await dragHandle(page, "Outer panel", "Inner panel", "above");
    await settled(page);
    expect(await order(page)).toEqual(["Outer panel", "Inner panel"]);
    expect(await statusBar(page).innerText()).not.toBe(before);
    await chooseMenu(page, ["Edit", /^Undo move panel/]);
    await settled(page);
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await expectClean(errors);
  });

  test("PL-H4 keyboard only: arrow keys on the handle move the panel, focus stays on it, and the move is announced", async ({ page }) => {
    await boot(page);
    const h = handle(page, "Inner panel");
    await h.focus();
    await page.keyboard.press("ArrowDown");
    expect(await order(page)).toEqual(["Outer panel", "Inner panel"]);
    await expect(handle(page, "Inner panel")).toBeFocused();
    await expect(page.locator("[aria-live=polite]", { hasText: /Inner panel moved to position 2 of 2/ })).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await expectClean(errors);
  });

  test("PL-E1 the ends are the ends: ArrowUp on the first and ArrowDown on the last do nothing and add no undo step", async ({ page }) => {
    await boot(page);
    await handle(page, "Inner panel").focus();
    await page.keyboard.press("ArrowUp");
    await handle(page, "Outer panel").focus();
    await page.keyboard.press("ArrowDown");
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expectClean(errors);
  });

  test("PL-E2 dropping where it started, or pressing Escape mid-drag, changes nothing", async ({ page }) => {
    await boot(page);
    await dragHandle(page, "Inner panel", "Inner panel", "above");
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await dragHandle(page, "Outer panel", "Inner panel", "above", false);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expectClean(errors);
  });

  test("PL-E3 clicking a handle without dragging does not open the editor or change the order", async ({ page }) => {
    await boot(page);
    await handle(page, "Outer panel").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await expectClean(errors);
  });

  test("PL-D1 the trash button asks first, naming the panel and what goes with it; Cancel and Escape keep it", async ({ page }) => {
    await boot(page);
    await trash(page, "Outer panel").click();
    const dlg = page.getByRole("dialog", { name: "Delete Outer panel?" });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(/8 ribs/);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await trash(page, "Outer panel").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await expectClean(errors);
  });

  test("PL-D2 confirming deletes that panel only, and Undo still brings it back", async ({ page }) => {
    await boot(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await trash(page, "Outer panel").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    expect(await order(page)).toEqual(["Inner panel"]);
    await expect(statusBar(page)).toContainText("9 ribs");
    await chooseMenu(page, ["Edit", /^Undo delete panel/]);
    await settled(page);
    expect(await order(page)).toEqual(["Inner panel", "Outer panel"]);
    await expectClean(errors);
  });

  test("PL-D3 the last panel cannot be deleted: its trash button is disabled and says why", async ({ page }) => {
    await boot(page);
    await trash(page, "Outer panel").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    await expect(trash(page, "Inner panel")).toBeDisabled();
    await expect(trash(page, "Inner panel")).toHaveAttribute("title", /at least one panel/i);
    await expectClean(errors);
  });

  test("PL-D4 deleting the panel whose editor is open is not possible: the dialog is modal", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    // inert behind the dialog: present, but nothing in it can be reached
    expect(await trash(page, "Outer panel").evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
    await expectClean(errors);
  });

  test("PL-S1 each card shows its airfoils, once when root and tip match", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0012");
    await page.getByRole("button", { name: /NACA 0012/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    const inner = panelCard(page, "Inner panel");
    await expect(inner.locator(".font-mono").first()).toHaveText("NACA 2412");
    await expect(inner.locator(".font-mono").last()).toHaveText("NACA 0012");
    // root is on the left and tip on the right
    const [a, b] = await inner.locator(".font-mono").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    expect(a).toBeLessThan(b);
    // one section at both ends is shown once, with no words saying root or tip
    const outer = panelCard(page, "Outer panel");
    await expect(outer.locator(".font-mono")).toHaveCount(1);
    await expect(outer).not.toContainText(/\b(root|tip)\b/i);
    await expectClean(errors);
  });

  test("PL-S2 a twist other than zero is shown opposite the airfoil name, and zero is not shown", async ({ page }) => {
    await boot(page);
    const inner = panelCard(page, "Inner panel");
    await expect(inner.getByLabel(/^Twist /)).toHaveCount(0);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Tip twist" }).fill("-2.5");
    await page.getByRole("spinbutton", { name: "Tip twist" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    // same foil at both ends but different twists: one box, root to tip
    await expect(inner.getByLabel("Twist 0° → -2.5°")).toBeVisible();
    // the section itself is drawn turned by the twist (solid), with the other end's dashed
    await expect(inner.locator('svg path[transform^="rotate(0)"]')).toHaveCount(1);
    await expect(inner.locator('svg path[transform^="rotate(-2.5)"]')).toHaveCount(1);
    await expect(inner.locator('svg path[stroke-dasharray]')).toHaveCount(1);
    // the twist sits on the same row as the name, on the other side
    const [n, t] = await Promise.all([inner.locator(".font-mono").first().boundingBox(), inner.getByLabel(/^Twist /).boundingBox()]);
    expect(Math.abs(n!.y - t!.y)).toBeLessThan(12);
    expect(t!.x).toBeGreaterThan(n!.x);
    // different foils: each end shows its own, and a zero end shows nothing
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0012");
    await page.getByRole("button", { name: /NACA 0012/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(inner.getByLabel(/^Twist /)).toHaveCount(1);
    await expect(inner.getByLabel("Twist -2.5°")).toBeVisible();
    await expect(inner.locator('svg path[transform^="rotate(-2.5)"]')).toHaveCount(1);
    await expect(inner.locator('svg path[stroke-dasharray]')).toHaveCount(0);
    await expectClean(errors);
  });

  test("PL-W1 on a wide desktop the panel definition window is 1416px, 20% wider than the 1180px it was", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await boot(page);
    await openPanel(page, "Inner panel");
    const box = (await page.getByRole("dialog").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(1414);
    expect(box.width).toBeLessThanOrEqual(1418);
    await expectClean(errors);
  });

  test("PL-E4 a long panel name does not push the list sideways or hide the handle and trash", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("textbox").first().fill("A very long panel name that goes on and on and on forever");
    await page.getByRole("textbox").first().blur();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(handle(page, "A very long panel name that goes on and on and on forever")).toBeInViewport();
    await expect(trash(page, "A very long panel name that goes on and on and on forever")).toBeInViewport();
    await expectClean(errors);
  });

  test("PL-E5 at phone width the handle and trash are still there and the page does not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await expect(handle(page, "Inner panel")).toBeInViewport();
    await expect(trash(page, "Inner panel")).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("PL-A1 no serious accessibility violations on the list", async ({ page }, info) => {
    await boot(page);
    await a11y(page, info, "PL-A1-panel-list");
    await expectClean(errors);
  });
});

test.describe("page title", () => {
  test("PT-H1 the tab title is 'Wing Buddy - <project name>', follows a rename, and carries no marker", async ({ page }) => {
    const errors: string[] = [];
    guard(page, errors);
    await boot(page);
    await expect(page).toHaveTitle("Wing Buddy - Trainer 1200");
    await page.getByRole("button", { name: /^Project name/ }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Slope Glider");
    await page.keyboard.press("Enter");
    await expect(page).toHaveTitle("Wing Buddy - Slope Glider");
    // editing something marks the project changed; the title must not change for that
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("250");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveTitle("Wing Buddy - Slope Glider");
    await expectClean(errors);
  });

  test("PT-E1 the title is right straight after a reload and after New", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: /^Project name/ }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Kept");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await expect(page).toHaveTitle("Wing Buddy - Kept");
    await chooseMenu(page, ["File", /^New/]);
    await page.getByRole("button", { name: /Delete this project and start new/ }).click();
    await expect(page).toHaveTitle("Wing Buddy - Trainer 1200");
  });
});
