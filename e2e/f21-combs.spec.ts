/** Rib combs: a wall along the span that the ribs slot into, set up on the Construction tab. */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });
const toConstruction = async (page: Page, panel = "Inner panel") => {
  await openPanel(page, panel);
  await page.getByRole("tab", { name: "Construction" }).click();
};
const members = async (page: Page) => {
  const t = (await page.locator("p.sr-only", { hasText: /Wing view/ }).first().textContent()) ?? "";
  return Number(/and (\d+) structural members/.exec(t)?.[1] ?? "-1");
};

test.describe("Rib combs", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("RC-H1 the Construction tab is open and starts with no combs, saying what a comb is", async ({ page }, info) => {
    await boot(page);
    await toConstruction(page);
    await expect(page.getByRole("tab", { name: "Rib comb" })).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("No combs yet");
    await expect(page.getByRole("dialog")).toContainText("ribs slot into");
    await a11y(page, info, "RC-H1-construction-tab");
    await expectClean(errors);
  });

  test("RC-H2 adding a comb shows its fields with sensible starting values, and it appears in the wing", async ({ page }) => {
    await boot(page);
    const before = await members(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await expect(page.getByRole("textbox", { name: "Comb name" })).toHaveValue("Comb 1");
    await expect(field(page, "Comb width")).toHaveValue("2.00");
    await expect(field(page, "Cut into rib")).toHaveValue("50.0");
    await expect(field(page, "Slit height")).toHaveValue("2.00");
    await expect(page.getByLabel("Ribs the comb crosses")).toContainText("Crosses ribs 1 to 9");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await members(page)).toBeGreaterThan(before);
    await expectClean(errors);
  });

  test("RC-H3 the comb is saved with its starting values", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.ribCombs).toHaveLength(1);
    expect(p.ribCombs[0].cutIntoRibPct).toBe(50);
    await expectClean(errors);
  });

  test("RC-H4 edits are one undo step each and are saved with the project", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await field(page, "Comb width").fill("3");
    await field(page, "Comb width").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    const p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.ribCombs[0].widthMm).toBe(3);
    await chooseMenu(page, ["Edit", /^Undo edit comb|^Undo comb width/]);
    await settled(page);
    expect((await exportProjectJson(page)).wing.panels[0].ribCombs[0].widthMm).toBe(2);
    await expectClean(errors);
  });

  test("RC-H5 a second comb goes below by default; selecting rows edits the right one; delete removes it", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await page.getByRole("button", { name: "Add comb" }).click();
    await expect(page.getByRole("textbox", { name: "Comb name" })).toHaveValue("Comb 2");
    await page.getByRole("button", { name: "Comb 1", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Comb name" })).toHaveValue("Comb 1");
    await page.getByRole("button", { name: "Delete comb" }).click();
    await expect(page.getByRole("button", { name: "Comb 1", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Comb 2", exact: true })).toBeVisible();
    await expectClean(errors);
  });

  test("RC-E1 'As tabs' greys out Extend", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await expect(field(page, "Comb extend")).toBeEnabled();
    await page.getByRole("checkbox", { name: /^As tabs/ }).check();
    await expect(field(page, "Comb extend")).toBeDisabled();
    await expectClean(errors);
  });

  test("RC-E2 a comb standing off the chord produces a warning, not a crash", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await field(page, "Comb distance (start)").fill("150");
    await field(page, "Comb distance (start)").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(page.getByText(/Comb 1 sits .* outside the chord/).first()).toBeVisible();
    await expectClean(errors);
  });

  test("RC-E3 the Rib comb view option is a real control and is on by default", async ({ page }) => {
    await boot(page);
    const box = page.getByRole("checkbox", { name: "Rib comb", exact: true });
    await expect(box).toBeChecked();
    await box.uncheck();
    await box.check();
    await expectClean(errors);
  });

  test("RC-E4 the OpenSCAD export has a Rib combs option that includes the comb solids", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await chooseMenu(page, ["File", "Export", /^Export OpenSCAD/]);
    const dlg = page.getByRole("dialog");
    for (const n of ["Ribs", "Leading edge", "Trailing edge", "Spars and webbing", "Sheeting"]) await dlg.getByRole("checkbox", { name: n, exact: true }).uncheck();
    const dl = page.waitForEvent("download");
    await dlg.getByRole("button", { name: "Save OpenSCAD" }).click();
    const text = await readFile((await (await dl).path())!, "utf8");
    expect(text.split("polyhedron(").length - 1).toBeGreaterThan(8);
    await expectClean(errors);
  });

  test("RC-E5 the tab fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("RC-E6 a comb survives a reload", async ({ page }) => {
    await boot(page);
    await toConstruction(page);
    await page.getByRole("button", { name: "Add comb" }).click();
    await page.getByRole("textbox", { name: "Comb name" }).fill("Top comb");
    await page.getByRole("textbox", { name: "Comb name" }).blur();
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(600);
    await page.reload();
    await settled(page);
    expect((await exportProjectJson(page)).wing.panels[0].ribCombs[0].name).toBe("Top comb");
    await expectClean(errors);
  });
});
