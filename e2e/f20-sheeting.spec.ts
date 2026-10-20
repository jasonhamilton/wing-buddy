/** Sheeting: none, standard, or named strips and cap strips; the rib is cut back under them. */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });
const toSheeting = async (page: Page, panel = "Inner panel") => {
  await openPanel(page, panel);
  await page.getByRole("tab", { name: "Sheeting" }).click();
};
const members = async (page: Page) => {
  const t = (await page.locator("p.sr-only", { hasText: /Wing view/ }).first().textContent()) ?? "";
  return Number(/and (\d+) structural members/.exec(t)?.[1] ?? "-1");
};
/** The height of the first rib in the DXF: the root rib of the inner panel, which is the one sheeted in these tests. */
async function firstRibHeight(page: Page): Promise<number> {
  await chooseMenu(page, ["File", "Export", /^Export DXF/]);
  const dl = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Save DXF" }).click();
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  await page.keyboard.press("Escape");
  const t = Buffer.concat(chunks).toString("utf8");
  const first = /0\nPOLYLINE\n8\nRIBS\n[\s\S]*?0\nSEQEND/.exec(t)![0];
  const ys = [...first.matchAll(/\n20\n(-?[\d.]+)\n/g)].map((m) => Number(m[1]));
  return Math.max(...ys) - Math.min(...ys);
}

test.describe("Sheeting", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("SH-H1 the Sheeting tab is open; it starts as None and says what that means", async ({ page }, info) => {
    await boot(page);
    await toSheeting(page);
    await expect(page.getByRole("radio", { name: "None" })).toBeChecked();
    await expect(page.getByRole("dialog")).toContainText("ribs are cut to the full airfoil");
    await a11y(page, info, "SH-H1-sheeting-tab");
    await expectClean(errors);
  });

  test("SH-H2 standard sheeting starts at 30% and 1.5mm, and cuts the ribs back under it", async ({ page }) => {
    await boot(page);
    const before = await firstRibHeight(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: /Standard, from the leading edge/ }).check();
    await expect(field(page, "Standard sheet length")).toHaveValue("30.0");
    await expect(field(page, "Standard sheet thickness")).toHaveValue("1.50");
    // 30% stops just short of the thickest point, so take the sheet back to 60% where it is in the band
    await field(page, "Standard sheet length").fill("60");
    await field(page, "Standard sheet length").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const after = await firstRibHeight(page);
    expect(after).toBeLessThan(before - 2.5); // 1.5mm off the top and 1.5mm off the bottom, less a little for the camber
    const p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.sheeting.type).toBe("standard");
    expect(p.sheeting.standardLength).toEqual({ unit: "pct", value: 60 });
    await expectClean(errors);
  });

  test("SH-H3 advanced: add a strip; it appears in the table and the 3D view gains a sheet on each surface", async ({ page }) => {
    await boot(page);
    await expect.poll(() => members(page)).toBeGreaterThanOrEqual(0);
    const base = await members(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await expect(page.getByRole("dialog")).toContainText("No strips yet");
    await page.getByRole("button", { name: "Add strip" }).click();
    await expect(page.getByRole("button", { name: "Strip 1" })).toBeVisible();
    await expect(field(page, "Strip thickness")).toHaveValue("1.50");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect.poll(() => members(page)).toBe(base + 2);
    await expectClean(errors);
  });

  test("SH-H4 a cap strip is a narrow slab on every rib: one per rib per surface", async ({ page }) => {
    await boot(page);
    await expect.poll(() => members(page)).toBeGreaterThanOrEqual(0);
    const base = await members(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("checkbox", { name: /Cap strip/ }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect.poll(() => members(page)).toBe(base + 9 * 2); // nine ribs, top and bottom
    await expectClean(errors);
  });

  test("SH-H5 starting at the trailing edge, in millimetres, with a separate end; the distance converts rather than reinterprets", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("radio", { name: "Trailing edge" }).check();
    const len = field(page, "Strip length (start)");
    await expect(len).toHaveValue("27.0");
    await page.getByRole("radiogroup", { name: "Strip length unit" }).getByText("mm", { exact: true }).click();
    await expect(len).toHaveValue("62.10"); // 27% of the 230mm root chord
    await page.getByRole("checkbox", { name: "Separate end value" }).last().check();
    await expect(field(page, "Strip length (end)")).toHaveValue("62.10");
    await page.getByRole("button", { name: "Done" }).click();
    const s = (await exportProjectJson(page)).wing.panels[0].sheeting.strips[0];
    expect(s.startingAt).toBe("TE");
    expect(s.length.start).toEqual({ unit: "mm", value: 62.1 });
    expect(s.length.end).toEqual({ unit: "mm", value: 62.1 });
    await expectClean(errors);
  });

  test("SH-E1 a strip on neither surface says it does nothing; deleting a strip is one undo step", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("checkbox", { name: "Apply to the top surface" }).uncheck();
    await page.getByRole("checkbox", { name: "Apply to the bottom surface" }).uncheck();
    await expect(page.getByRole("dialog")).toContainText("neither surface");
    await page.getByRole("button", { name: "Delete strip" }).click();
    await expect(page.getByRole("dialog")).toContainText("No strips yet");
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo delete strip/]);
    expect((await exportProjectJson(page)).wing.panels[0].sheeting.strips).toHaveLength(1);
    await expectClean(errors);
  });

  test("SH-E2 a sheet thicker than the section is deep is reported, not silently built", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await field(page, "Strip thickness").fill("20");
    await field(page, "Strip thickness").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.getByLabel("Geometry warnings")).toContainText(/thicker than the section is deep/);
    await expectClean(errors);
  });

  test("SH-E3 a span that ends before it starts is flagged on the field", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await field(page, "Strip span end").fill("0");
    await field(page, "Strip span end").press("Enter");
    await expect(page.getByRole("dialog")).toContainText("The end must be past the start");
    await expectClean(errors);
  });

  test("SH-E4 standard sheeting's length converts between % and a length without changing the sheet", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: /Standard, from the leading edge/ }).check();
    await page.getByRole("radiogroup", { name: "Standard sheet length unit" }).getByText("mm", { exact: true }).click();
    await expect(field(page, "Standard sheet length")).toHaveValue("69.00"); // 30% of 230mm
    await page.getByRole("radiogroup", { name: "Standard sheet length unit" }).getByText("%", { exact: true }).click();
    await expect(field(page, "Standard sheet length")).toHaveValue("30.0");
    await expectClean(errors);
  });

  test("SH-E5 a strip can have a colour of its own, and the 3D view draws it", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("button", { name: /^Strip colour: standard/ }).click();
    await page.getByRole("dialog", { name: "Strip colour" }).getByRole("button", { name: /^Red #ff0000$/ }).click();
    await page.getByRole("dialog", { name: "Strip colour" }).getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].sheeting.strips[0].color).toBe("#ff0000");
    await expect.poll(async () => Number(await page.locator("[data-custom-coloured]").first().getAttribute("data-custom-coloured"))).toBeGreaterThan(0);
    await expectClean(errors);
  });

  test("SH-E6 the view option Sheeting is a real control, on by default", async ({ page }) => {
    await boot(page);
    const box = page.getByRole("checkbox", { name: "Sheeting", exact: true });
    await expect(box).toBeChecked();
    await box.uncheck();
    await box.check();
    await expectClean(errors);
  });

  test("SH-E7 the OpenSCAD export includes the sheets when Sheeting is ticked, and leaves them out when it is not", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const scad = async (untick: boolean) => {
      await chooseMenu(page, ["File", "Export", /^Export OpenSCAD/]);
      const dlg = page.getByRole("dialog");
      for (const n of ["Ribs", "Leading edge", "Trailing edge", "Spars and webbing", "Rib combs"]) await dlg.getByRole("checkbox", { name: n, exact: true }).uncheck();
      if (untick) await dlg.getByRole("checkbox", { name: "Sheeting", exact: true }).uncheck();
      if (untick) {
        await expect(dlg.getByRole("button", { name: "Save OpenSCAD" })).toBeDisabled();
        await page.keyboard.press("Escape");
        return "";
      }
      const dl = page.waitForEvent("download");
      await dlg.getByRole("button", { name: "Save OpenSCAD" }).click();
      const text = await readFile((await (await dl).path())!, "utf8");
      await page.keyboard.press("Escape");
      return text;
    };
    const withSheets = await scad(false);
    expect(withSheets.split("polyhedron(").length - 1).toBe(2); // top and bottom
    await scad(true);
    await expectClean(errors);
  });

  test("SH-E8 the tab fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("SH-E9 changes to sheeting are saved with the project and survive a reload", async ({ page }) => {
    await boot(page);
    await toSheeting(page);
    await page.getByRole("radio", { name: "Advanced strips" }).check();
    await page.getByRole("button", { name: "Add strip" }).click();
    await page.getByRole("textbox", { name: "Strip name" }).fill("Main skin");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await toSheeting(page);
    await expect(page.getByRole("button", { name: "Main skin" })).toBeVisible();
    await expectClean(errors);
  });
});
