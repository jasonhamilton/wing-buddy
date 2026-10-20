/** F03 — add structure. */
import { expect, test } from "@playwright/test";
import { a11y, boot, expectClean, guard, openPanel, settled, chooseMenu } from "./helpers";

test.describe("F03 spars", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const toSpars = async (page: import("@playwright/test").Page) => {
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
  };

  test("F03-H1 add a spar, set it, see the rib change", async ({ page }, info) => {
    await boot(page);
    await toSpars(page);
    await page.getByRole("button", { name: "Add spar" }).click();
    await expect(page.getByRole("cell", { name: "Spar 3" })).toBeVisible();

    await page.getByRole("spinbutton", { name: "Distance from the datum edge" }).fill("60");
    await page.getByRole("spinbutton", { name: "Distance from the datum edge" }).press("Enter");
    await page.getByRole("spinbutton", { name: "Width" }).fill("10");
    await page.getByRole("spinbutton", { name: "Width" }).press("Enter");
    await expect(page.getByRole("img", { name: /Rib outline/ })).toBeVisible();

    await a11y(page, info, "F03-H1-spars-tab");
    await expectClean(errors);
  });

  test("F03-H2 every spar type builds without an error", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    for (const type of ["Round", "Webbing", "Round joiner", "Cuboid", "Cuboid joiner", "Aileron cutter", "Rectangle"]) {
      await page.getByLabel("Spar type").selectOption({ label: type });
      await page.waitForTimeout(250);
      await expect(page.getByRole("img", { name: /Rib outline/ }), `${type} produced no rib`).toBeVisible();
    }
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expectClean(errors);
  });

  test("F03-E1 switching % to mm converts the value, it does not reinterpret it", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    const distance = page.getByRole("spinbutton", { name: "Distance from the datum edge" });
    await expect(distance).toHaveValue("28.00"); // % of a 230mm chord
    await page.getByRole("radiogroup", { name: "Distance unit" }).getByText("mm").click();
    await expect(distance).toHaveValue("64.40"); // 28% of 230, not 28mm
    await expectClean(errors);
  });

  test("F03-E2 a spar past the chord warns instead of throwing", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    const distance = page.getByRole("spinbutton", { name: "Distance from the datum edge" });
    await distance.fill("180");
    await distance.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.locator("body")).toContainText(/outside the chord/i);
    await expectClean(errors);
  });

  test("F03-E3 a spar end before its start is flagged on the field", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    const end = page.getByRole("spinbutton", { name: "Span end" });
    await end.fill("0");
    await end.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(/end must be past the start/i);
    await expectClean(errors);
  });

  test("F03-E4 a spar past the tip warns with the overshoot", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    const end = page.getByRole("spinbutton", { name: "Span end" });
    await end.fill("980");
    await end.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(/past the tip of this panel/i);
    await expectClean(errors);
  });

  test("F03-E5 an oversized joiner warns rather than destroying the rib", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    await page.getByRole("cell", { name: "Wing joiner" }).click();
    const radius = page.getByRole("spinbutton", { name: "Radius" });
    await radius.fill("40");
    await radius.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning|error/i }).click();
    await expect(page.locator("body")).toContainText(/breaks the surface/i);
    await expectClean(errors);
  });

  test("F03-E6 deleting a spar is undoable", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    await page.getByRole("cell", { name: "Main spar" }).click();
    await page.getByRole("button", { name: "Delete spar" }).click();
    await expect(page.getByRole("cell", { name: "Main spar" })).toHaveCount(0);
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo/]);
    await settled(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await expect(page.getByRole("cell", { name: "Main spar" })).toBeVisible();
    await expectClean(errors);
  });

  test("F03-E7 removing every spar leaves a usable empty state", async ({ page }) => {
    await boot(page);
    await toSpars(page);
    for (const name of ["Main spar", "Wing joiner"]) {
      await page.getByRole("cell", { name }).click();
      await page.getByRole("button", { name: "Delete spar" }).click();
    }
    await expect(page.getByRole("dialog")).toContainText("No spars yet");
    await expectClean(errors);
  });
});
