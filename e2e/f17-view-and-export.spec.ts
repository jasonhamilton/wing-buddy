/** Round-two items about what you see and what you export: ghost panels, DXF options, and so on. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, guard, openPanel, panelCard, settled } from "./helpers";

test.describe("Ghost panels", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const ghosted = async (page: Page) => Number(await page.locator("[data-ghosted]").first().getAttribute("data-ghosted"));
  const ghostBox = (page: Page) => page.getByRole("checkbox", { name: "Ghost the other panels" });

  test("GH-H1 nothing is ghosted until asked; then the panels other than the selected one are", async ({ page }) => {
    await boot(page);
    expect(await ghosted(page)).toBe(0);
    await ghostBox(page).check();
    await expect.poll(() => ghosted(page)).toBeGreaterThan(0);
    await expect(page.locator("p.sr-only[aria-live=polite]", { hasText: /Wing view/ })).toContainText("1 panel shown as ghosts");
    await ghostBox(page).uncheck();
    await expect.poll(() => ghosted(page)).toBe(0);
    await expectClean(errors);
  });

  test("GH-H2 selecting the other panel swaps which one is ghosted", async ({ page }) => {
    await boot(page);
    await ghostBox(page).check();
    await expect.poll(() => ghosted(page)).toBeGreaterThan(0);
    const first = await ghosted(page); // the outer panel is the ghost while the inner one is selected
    await panelCard(page, "Outer panel").click();
    await expect.poll(() => ghosted(page)).not.toBe(first);
    await expect.poll(() => ghosted(page)).toBeGreaterThan(0);
    await expectClean(errors);
  });

  test("GH-E1 gray ghosts and the ghost transparency slider wake up with ghosting, and not before", async ({ page }) => {
    await boot(page);
    await expect(page.getByRole("checkbox", { name: "Gray ghosts" })).toBeDisabled();
    await expect(page.getByRole("slider", { name: "Ghost transparency" })).toBeDisabled();
    await ghostBox(page).check();
    await expect(page.getByRole("checkbox", { name: "Gray ghosts" })).toBeEnabled();
    await expect(page.getByRole("slider", { name: "Ghost transparency" })).toBeEnabled();
    await expect(page.getByRole("slider", { name: "Ghost transparency" })).toHaveValue("70");
    await expectClean(errors);
  });

  test("GH-E2 the slider and the gray option change the view without losing the ghosts", async ({ page }) => {
    await boot(page);
    await ghostBox(page).check();
    await expect.poll(() => ghosted(page)).toBeGreaterThan(0);
    const n = await ghosted(page);
    const slider = page.getByRole("slider", { name: "Ghost transparency" });
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("71");
    await page.getByRole("checkbox", { name: "Gray ghosts" }).check();
    await expect.poll(() => ghosted(page)).toBe(n);
    await expectClean(errors);
  });

  test("GH-E3 a single-panel wing has nothing to ghost", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Delete Outer panel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    await ghostBox(page).check();
    await page.waitForTimeout(300);
    expect(await ghosted(page)).toBe(0);
    await expect(page.locator("p.sr-only[aria-live=polite]", { hasText: /Wing view/ })).not.toContainText("ghost");
    await expectClean(errors);
  });

  test("GH-E4 turning off both halves halves the ghosted parts", async ({ page }) => {
    await boot(page);
    await ghostBox(page).check();
    await expect.poll(() => ghosted(page)).toBeGreaterThan(0);
    const both = await ghosted(page);
    await page.getByRole("checkbox", { name: "Both halves" }).uncheck();
    await expect.poll(() => ghosted(page)).toBe(both / 2);
    await expectClean(errors);
  });

  test("GH-A1 no serious accessibility violations with ghosting on", async ({ page }, info) => {
    await boot(page);
    await ghostBox(page).check();
    await a11y(page, info, "GH-A1-ghosts");
    await expectClean(errors);
  });
});

test.describe("DXF options", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  async function dxf(page: Page, tick: string[] = [], thickness?: string): Promise<string> {
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const dlg = page.getByRole("dialog", { name: "Export to DXF" });
    for (const name of tick) await dlg.getByRole("checkbox", { name }).check();
    if (thickness) {
      const f = dlg.getByRole("spinbutton", { name: "Trailing edge minimum thickness" });
      await f.fill(thickness);
      await f.press("Enter");
    }
    const dl = page.waitForEvent("download");
    await dlg.getByRole("button", { name: "Save DXF" }).click();
    const chunks: Buffer[] = [];
    for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
    await page.keyboard.press("Escape");
    return Buffer.concat(chunks).toString("utf8");
  }
  const polylinesOn = (t: string, layer: string) => t.split(`0\nPOLYLINE\n8\n${layer}\n`).length - 1;
  const maxX = (t: string) => Math.max(...[...t.matchAll(/\n10\n(-?[\d.]+)\n/g)].map((m) => Number(m[1])));

  test("DX-H1 the silhouette option adds a SILHOUETTE layer, one outline per rib, and nothing else moves", async ({ page }, info) => {
    await boot(page);
    const plain = await dxf(page);
    const guide = await dxf(page, ["Draw the original rib silhouette"]);
    expect(polylinesOn(plain, "SILHOUETTE")).toBe(0);
    expect(polylinesOn(guide, "SILHOUETTE")).toBe(17);
    expect(polylinesOn(guide, "RIBS")).toBe(polylinesOn(plain, "RIBS"));
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    await a11y(page, info, "DX-H1-dxf-options");
    await expectClean(errors);
  });

  test("DX-H2 trimming is off until ticked; its thickness field wakes with it", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("spinbutton", { name: "Trailing edge minimum thickness" })).toBeDisabled();
    await dlg.getByRole("checkbox", { name: "Trim sharp trailing edges" }).check();
    await expect(dlg.getByRole("spinbutton", { name: "Trailing edge minimum thickness" })).toHaveValue("0.80");
    await expectClean(errors);
  });

  test("DX-E1 on a project with sharp trailing edges, trimming shortens the ribs; a thicker minimum cuts further", async ({ page }) => {
    await boot(page);
    // the example wing has trailing-edge stock, which already leaves a blunt face; switch it off on both panels
    for (const name of ["Inner panel", "Outer panel"]) {
      await openPanel(page, name);
      await page.getByRole("tab", { name: "Trailing Edge" }).click();
      await page.getByRole("checkbox", { name: /Use trailing edge stock/ }).uncheck();
      await page.getByRole("button", { name: "Done" }).click();
    }
    await settled(page);
    const base = maxX(await dxf(page));
    const trimmed = maxX(await dxf(page, ["Trim sharp trailing edges"]));
    const more = maxX(await dxf(page, ["Trim sharp trailing edges"], "2"));
    expect(trimmed).toBeLessThan(base);
    expect(more).toBeLessThan(trimmed);
    await expectClean(errors);
  });

  test("DX-E2 trimming a rib whose edge is already blunt (stock cut) changes nothing", async ({ page }) => {
    await boot(page);
    const base = await dxf(page);
    const trimmed = await dxf(page, ["Trim sharp trailing edges"]);
    expect(trimmed).toBe(base);
    await expectClean(errors);
  });

  test("DX-E3 the options work in inches too, and the file is millimetres either way", async ({ page }) => {
    await boot(page);
    const mm = await dxf(page, ["Draw the original rib silhouette"]);
    await page.getByRole("radio", { name: "Inches" }).check({ force: true });
    const inch = await dxf(page, ["Draw the original rib silhouette"]);
    expect(inch).toBe(mm);
    await expectClean(errors);
  });
});
