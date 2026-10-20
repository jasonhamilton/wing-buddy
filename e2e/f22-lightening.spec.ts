/** Lightening holes: standard holes through each rib's web, set up on the Construction tab. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });
const toHoles = async (page: Page, panel = "Inner panel") => {
  await openPanel(page, panel);
  await page.getByRole("tab", { name: "Construction" }).click();
  await page.getByRole("tab", { name: "Lightening holes" }).click();
};
/** How many closed shapes the DXF has on the HOLES layer. */
async function holeCount(page: Page): Promise<number> {
  await chooseMenu(page, ["File", "Export", /^Export DXF/]);
  const dl = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Save DXF" }).click();
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  await page.keyboard.press("Escape");
  const t = Buffer.concat(chunks).toString("utf8");
  return t.split("0\nPOLYLINE\n8\nHOLES\n").length - 1;
}

test.describe("Lightening holes", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("LH-H1 the tab starts at None and says what that means", async ({ page }, info) => {
    await boot(page);
    await toHoles(page);
    await expect(page.getByRole("radio", { name: "None" })).toBeChecked();
    await expect(page.getByRole("dialog")).toContainText("web of each rib is left solid");
    await a11y(page, info, "LH-H1-lightening-tab");
    await expectClean(errors);
  });

  test("LH-H2 choosing Standard shows the settings and puts holes in the ribs", async ({ page }) => {
    await boot(page);
    const before = await holeCount(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    await expect(field(page, "Hole width maximum")).toHaveValue("40.00");
    await expect(field(page, "Distance between holes")).toHaveValue("5.00");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await holeCount(page)).toBeGreaterThan(before);
    expect((await exportProjectJson(page)).wing.panels[0].lighteningHoles.type).toBe("standard");
    await expectClean(errors);
  });

  test("LH-H3 a smaller maximum width makes more holes; a minimum wider than any gap makes none beyond the spar bores", async ({ page }) => {
    await boot(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const base = await holeCount(page);
    await toHoles(page);
    await field(page, "Hole width maximum").fill("20");
    await field(page, "Hole width maximum").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const more = await holeCount(page);
    expect(more).toBeGreaterThan(base);
    await toHoles(page);
    await field(page, "Hole width minimum").fill("400");
    await field(page, "Hole width minimum").press("Enter");
    await field(page, "Hole width maximum").fill("500");
    await field(page, "Hole width maximum").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await holeCount(page)).toBeLessThan(base);
    await expectClean(errors);
  });

  test("LH-E1 the corner settings are greyed out when corners are not rounded", async ({ page }) => {
    await boot(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    await expect(field(page, "Hole roundness")).toBeEnabled();
    await page.getByRole("checkbox", { name: "Round the corners" }).uncheck();
    await expect(field(page, "Hole roundness")).toBeDisabled();
    await expect(field(page, "Hole smoothness")).toBeDisabled();
    await expectClean(errors);
  });

  test("LH-E2 one undo step takes the holes back out", async ({ page }) => {
    await boot(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo lightening holes type/]);
    await settled(page);
    expect((await exportProjectJson(page)).wing.panels[0].lighteningHoles.type).toBe("none");
    await expectClean(errors);
  });

  test("LH-E3 the settings survive a reload", async ({ page }) => {
    await boot(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    await field(page, "Hole width maximum").fill("33");
    await field(page, "Hole width maximum").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(600);
    await page.reload();
    await settled(page);
    const h = (await exportProjectJson(page)).wing.panels[0].lighteningHoles;
    expect(h.type).toBe("standard");
    expect(h.maxWidthMm).toBe(33);
    await expectClean(errors);
  });

  test("LH-E4 the tab fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await toHoles(page);
    await page.getByRole("radio", { name: "Standard" }).check();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });
});
