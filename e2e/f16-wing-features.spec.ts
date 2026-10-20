/** Round-one musts: adding a panel three ways, airfoils blended across panels, edge shapes, nose smoothing, OpenSCAD. */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { a11y, addPanel, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });

test.describe("Add a panel: three ways", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("CP-H1 the + asks how the new panel should start; carrying on is suggested, and Cancel adds nothing", async ({ page }, info) => {
    await boot(page);
    await page.getByRole("button", { name: "Add panel", exact: true }).click();
    const dlg = page.getByRole("dialog", { name: "Add a panel" });
    await expect(dlg.getByRole("radio")).toHaveCount(3);
    await expect(dlg.getByRole("radio", { name: /Carry on from the previous tip/ })).toBeChecked();
    await expect(dlg).toContainText("suggested");
    await a11y(page, info, "CP-H1-copy-dialog");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    expect((await exportProjectJson(page)).wing.panels).toHaveLength(2);
    await expectClean(errors);
  });

  test("CP-H2 carry on: starts on the previous tip, links the airfoil, and the spar that reaches the join continues", async ({ page }) => {
    await boot(page);
    await addPanel(page, "smart");
    const p = (await exportProjectJson(page)).wing.panels[2];
    expect(p.rootChordMm).toBe(155);
    expect(p.tipChordMm).toBe(155);
    expect(p.airfoilLinkedToPrev).toBe(true);
    expect(p.spars).toHaveLength(1);
    expect(p.spars[0].spanStartMm).toBe(0);
    expect(p.spars[0].spanEndMm).toBe(p.lengthMm);
    await expectClean(errors);
  });

  test("CP-H3 mirror: chords and sweep run backwards", async ({ page }) => {
    await boot(page);
    await addPanel(page, "mirror");
    const json = await exportProjectJson(page);
    const outer = json.wing.panels[1];
    const p = json.wing.panels[2];
    expect(p.rootChordMm).toBe(outer.tipChordMm); // 155
    expect(p.tipChordMm).toBe(outer.rootChordMm); // 230
    expect(p.sweepMm).toBe(-outer.sweepMm);
    expect(p.airfoilLinkedToPrev).toBe(false);
    await expectClean(errors);
  });

  test("CP-H4 duplicate: an exact copy, ribs and spars included", async ({ page }) => {
    await boot(page);
    await addPanel(page, "direct");
    const json = await exportProjectJson(page);
    const outer = json.wing.panels[1];
    const p = json.wing.panels[2];
    expect(p.rootChordMm).toBe(outer.rootChordMm);
    expect(p.tipChordMm).toBe(outer.tipChordMm);
    expect(p.ribs).toHaveLength(outer.ribs.length);
    expect(p.spars).toHaveLength(outer.spars.length);
    expect(p.id).not.toBe(outer.id);
    await expectClean(errors);
  });

  test("CP-E1 Escape closes it without adding anything; the choice can be made by keyboard alone", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Add panel", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await exportProjectJson(page)).wing.panels).toHaveLength(2);

    await page.getByRole("button", { name: "Add panel", exact: true }).click();
    await page.getByRole("radio", { name: /Carry on/ }).focus();
    await page.keyboard.press("ArrowDown"); // to the next radio in the group
    await expect(page.getByRole("radio", { name: /Mirror/ })).toBeChecked();
    await page.getByRole("button", { name: "Add panel" }).last().click();
    expect((await exportProjectJson(page)).wing.panels[2].sweepMm).toBe(-38);
    await expectClean(errors);
  });

  test("CP-E2 adding a panel is one undo step, whichever way", async ({ page }) => {
    await boot(page);
    for (const m of ["smart", "mirror", "direct"] as const) {
      await addPanel(page, m);
      await chooseMenu(page, ["Edit", /^Undo add panel/]);
      expect((await exportProjectJson(page)).wing.panels).toHaveLength(2);
    }
    await expectClean(errors);
  });
});

test.describe("Airfoil blended through the previous panel", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const link = (page: Page) => page.getByRole("checkbox", { name: /Blend smoothly through the previous panel/ });

  test("LK-H1 the first panel cannot be linked and says why; the second can", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(link(page)).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText("nothing before it");
    await page.getByRole("button", { name: "Done" }).click();
    await openPanel(page, "Outer panel");
    await expect(link(page)).toBeEnabled();
    await expectClean(errors);
  });

  test("LK-H2 linking makes the root follow the previous tip, and locks the root controls", async ({ page }) => {
    await boot(page);
    // give the inner panel a different tip so there is something to follow
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0012");
    await page.getByRole("button", { name: /NACA 0012/ }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await openPanel(page, "Outer panel");
    await link(page).check();
    const dlg = page.getByRole("dialog");
    await expect(dlg.locator("label", { hasText: "Root section:" }).locator("xpath=following-sibling::div[1]")).toContainText("NACA 0012");
    await expect(dlg).toContainText("from the previous panel");
    await expect(page.getByRole("radio", { name: "Root rib" })).toBeDisabled();
    await expect(field(page, "Root thickness factor")).toBeDisabled();
    await page.getByRole("button", { name: "Done" }).click();
    const outer = (await exportProjectJson(page)).wing.panels[1];
    expect(outer.airfoilLinkedToPrev).toBe(true);
    expect(outer.rootAirfoilId).toBe("naca-0012");
    await expectClean(errors);
  });

  test("LK-H3 changing the previous panel's tip carries through to the linked panel", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    await link(page).check();
    await page.getByRole("button", { name: "Done" }).click();
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0015");
    await page.getByRole("button", { name: /NACA 0015/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    expect((await exportProjectJson(page)).wing.panels[1].rootAirfoilId).toBe("naca-0015");
    await expectClean(errors);
  });

  test("LK-E1 linking and unlinking are each one undo step, and unlinking hands the root controls back", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    await link(page).check();
    await link(page).uncheck();
    await expect(page.getByRole("radio", { name: "Root rib" })).toBeEnabled();
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo airfoil link/]);
    expect((await exportProjectJson(page)).wing.panels[1].airfoilLinkedToPrev).toBe(true);
    await expectClean(errors);
  });

  test("LK-E2 moving a linked panel to the front: the link means nothing there, and nothing breaks", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    await link(page).check();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Reorder Outer panel" }).focus();
    await page.keyboard.press("ArrowUp");
    await settled(page);
    await openPanel(page, "Outer panel");
    await expect(link(page)).toBeDisabled();
    await page.getByRole("button", { name: "Done" }).click();
    await expectClean(errors);
  });

  test("LK-E3 deleting the panel a linked one follows leaves the survivor intact", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Outer panel");
    await link(page).check();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Delete Inner panel" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete panel" }).click();
    await settled(page);
    await openPanel(page, "Outer panel");
    await expect(link(page)).toBeDisabled(); // first now
    await expect(page.getByRole("dialog")).toContainText("NACA 2412");
    await expectClean(errors);
  });
});

test.describe("Edge stock shape", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("ED-H1 the leading and trailing edge tabs each offer three shapes, saved with the project", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    for (const [tab, key] of [["Leading Edge", "leadingEdge"], ["Trailing Edge", "trailingEdge"]] as const) {
      await page.getByRole("tab", { name: tab }).click();
      const sel = page.getByRole("combobox", { name: "Stock shape" });
      expect(await sel.locator("option").allInnerTexts()).toEqual(["Rectangular strip", "Tapered wedge", "Rounded edge"]);
      await sel.selectOption("round");
      await expect(sel).toHaveValue("round");
      void key;
    }
    await page.getByRole("button", { name: "Done" }).click();
    const p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.leadingEdge.shape).toBe("round");
    expect(p.trailingEdge.shape).toBe("round");
    await expectClean(errors);
  });

  test("ED-E1 the shape is disabled while the stock is off, and a change is one undo step", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Leading Edge" }).click();
    await page.getByRole("checkbox", { name: /Use leading edge stock/ }).uncheck();
    await expect(page.getByRole("combobox", { name: "Stock shape" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Use leading edge stock/ }).check();
    await page.getByRole("combobox", { name: "Stock shape" }).selectOption("triangle");
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo edge stock/]);
    expect((await exportProjectJson(page)).wing.panels[0].leadingEdge.shape).toBe("rectangle");
    await expectClean(errors);
  });

  test("ED-E2 a block too short to cover the airfoil is warned about for every shape, and Fit height to wing clears it", async ({ page }) => {
    await boot(page);
    for (const shape of ["rectangle", "triangle", "round"]) {
      await openPanel(page, "Inner panel");
      await page.getByRole("tab", { name: "Trailing Edge" }).click();
      await page.getByRole("combobox", { name: "Stock shape" }).selectOption(shape);
      await field(page, "Stock height").fill("1");
      await field(page, "Stock height").press("Enter");
      await page.getByRole("button", { name: "Done" }).click();
      await settled(page);
      await page.getByRole("button", { name: /warning/i }).click();
      await expect(page.getByLabel("Geometry warnings")).toContainText(/trailing edge stock is .* too low/);
      await page.getByRole("button", { name: /warning/i }).click();
      await openPanel(page, "Inner panel");
      await page.getByRole("tab", { name: "Trailing Edge" }).click();
      await page.getByRole("button", { name: "Fit height to wing", exact: true }).click();
      await page.getByRole("button", { name: "Done" }).click();
      await settled(page);
      await expect(page.getByRole("button", { name: /warning/i })).toHaveCount(0);
    }
    await expectClean(errors);
  });
});

test.describe("Nose smoothing", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const smooth = (page: Page) => page.getByRole("checkbox", { name: /Smooth the nose of the ribs/ });

  test("NS-H1 off by default; ticking it wakes the extent, which is saved with the project", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(smooth(page)).not.toBeChecked();
    await expect(field(page, "Nose smoothing extent")).toBeDisabled();
    await smooth(page).check();
    await expect(field(page, "Nose smoothing extent")).toBeEnabled();
    await expect(field(page, "Nose smoothing extent")).toHaveValue("8.0");
    await field(page, "Nose smoothing extent").fill("12");
    await field(page, "Nose smoothing extent").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].noseSmoothing).toEqual({ enabled: true, extentPct: 12 });
    await expectClean(errors);
  });

  test("NS-E1 the extent is held between 1% and 30% of the chord", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await smooth(page).check();
    await field(page, "Nose smoothing extent").fill("90");
    await field(page, "Nose smoothing extent").press("Enter");
    await expect(field(page, "Nose smoothing extent")).toHaveValue("30.0");
    await field(page, "Nose smoothing extent").fill("0");
    await field(page, "Nose smoothing extent").press("Enter");
    await expect(field(page, "Nose smoothing extent")).toHaveValue("1.0");
    await expectClean(errors);
  });

  test("NS-E2 on a lumpy imported section it changes the DXF; on a section that is already smooth it barely does", async ({ page }) => {
    await boot(page);
    const dxf = async () => {
      const dl = page.waitForEvent("download");
      await chooseMenu(page, ["File", "Export", /^Export DXF/]);
      await page.getByRole("button", { name: "Save DXF" }).click();
      await page.keyboard.press("Escape");
      const chunks: Buffer[] = [];
      for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const coords = (t: string) => t.split("\n").map(Number).filter((n) => Number.isFinite(n) && n !== 0).slice(0, 4000);
    const off = await dxf();
    await openPanel(page, "Inner panel");
    await smooth(page).check();
    await page.getByRole("button", { name: "Done" }).click();
    const on = await dxf();
    expect(on).not.toBe(off); // it does something
    const a = coords(off);
    const b = coords(on);
    const worst = Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? v))));
    expect(worst).toBeLessThan(0.3); // a clean NACA section moves by well under a third of a millimetre
    await expectClean(errors);
  });
});

test.describe("Export to OpenSCAD", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const open = (page: Page) => chooseMenu(page, ["File", "Export", /^Export OpenSCAD/]);
  async function save(page: Page): Promise<string> {
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save OpenSCAD" }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(/\.scad$/);
    return readFile((await d.path())!, "utf8");
  }
  const n = (t: string, needle: string) => t.split(needle).length - 1;

  test("SC-H1 the dialog offers the parts, and the file has ribs, spars and edges in it", async ({ page }, info) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog", { name: "Export to OpenSCAD" });
    for (const name of ["Ribs", "Leading edge", "Trailing edge", "Spars and webbing", "Sheeting", "Rib combs", "Both wing halves"]) {
      await expect(dlg.getByRole("checkbox", { name, exact: true })).toBeChecked();
    }
    await a11y(page, info, "SC-H1-scad-dialog");
    const text = await save(page);
    expect(n(text, "linear_extrude(")).toBe(17);
    expect(n(text, "polyhedron(")).toBeGreaterThan(5);
    expect(text).toContain("mirror([1, 0, 0]) wing_half();");
    await expectClean(errors);
  });

  test("SC-H2 unticking parts leaves them out of the file", async ({ page }) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog");
    for (const name of ["Leading edge", "Trailing edge", "Spars and webbing", "Sheeting", "Rib combs", "Both wing halves"]) await dlg.getByRole("checkbox", { name, exact: true }).uncheck();
    const text = await save(page);
    expect(n(text, "polyhedron(")).toBe(0);
    expect(n(text, "linear_extrude(")).toBe(17);
    expect(text).not.toContain("mirror(");
    await expectClean(errors);
  });

  test("SC-E1 with nothing chosen, Save is off and the dialog says why", async ({ page }) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog");
    for (const name of ["Ribs", "Leading edge", "Trailing edge", "Spars and webbing", "Sheeting", "Rib combs"]) await dlg.getByRole("checkbox", { name, exact: true }).uncheck();
    await expect(dlg.getByRole("button", { name: "Save OpenSCAD" })).toBeDisabled();
    await expect(dlg).toContainText("Choose at least one part");
    await expectClean(errors);
  });

  test("SC-E2 the space between panels is off until asked for, and then moves each panel one step further", async ({ page }) => {
    await boot(page);
    await open(page);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("spinbutton", { name: "Space between panels" })).toBeDisabled();
    await dlg.getByRole("checkbox", { name: /Extra space between panels/ }).check();
    await dlg.getByRole("spinbutton", { name: "Space between panels" }).fill("60");
    await dlg.getByRole("spinbutton", { name: "Space between panels" }).press("Enter");
    const text = await save(page);
    expect(text).toMatch(/translate\(\[60, 0, 0\]\) panel_2\(\);/);
    await expectClean(errors);
  });

  test("SC-E3 in inches the spacing is typed in inches but the file is millimetres, identical either way", async ({ page }) => {
    await boot(page);
    await open(page);
    const mm = await save(page);
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Inches" }).check({ force: true });
    await open(page);
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("checkbox", { name: /Extra space between panels/ }).check();
    await expect(dlg.getByRole("spinbutton", { name: "Space between panels" })).toHaveValue("1.575"); // 40mm
    await dlg.getByRole("checkbox", { name: /Extra space between panels/ }).uncheck();
    const inches = await save(page);
    expect(inches).toBe(mm);
    await expectClean(errors);
  });

  test("SC-E4 an edited project is what gets exported: a longer panel makes a longer model", async ({ page }) => {
    await boot(page);
    await open(page);
    const before = await save(page);
    await page.keyboard.press("Escape");
    await openPanel(page, "Outer panel");
    await field(page, "Panel length").fill("380");
    await field(page, "Panel length").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await open(page);
    const after = await save(page);
    expect(after).not.toBe(before);
    await expectClean(errors);
  });

  test("SC-E5 it fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await open(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.getByRole("button", { name: "Save OpenSCAD" })).toBeVisible();
    await expectClean(errors);
  });
});
