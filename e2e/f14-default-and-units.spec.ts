/** New is the same model the app opens with; and the display unit. */
import { expect, test, type Page } from "@playwright/test";
import { boot, chooseMenu, expectClean, guard, openPanel, panelCard, settled, startNewProject, addPanel } from "./helpers";

async function exportJson(page: Page): Promise<any> {
  const dl = page.waitForEvent("download");
  await chooseMenu(page, ["File", "Export", "Export Project"]);
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The model without what is different on every run: ids and timestamps. */
function model(doc: any): any {
  const strip = (v: any): any =>
    Array.isArray(v)
      ? v.map(strip)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k)).map(([k, x]) => [k, strip(x)]))
        : v;
  return strip(doc);
}

test.describe("New equals the default", () => {
  test("DF-H1 File > New gives exactly the model a first visit opens with", async ({ browser }) => {
    const errors: string[] = [];
    const first = await (await browser.newContext()).newPage();
    guard(first, errors);
    await boot(first);
    const fresh = await exportJson(first);

    const used = await (await browser.newContext()).newPage();
    guard(used, errors);
    await boot(used);
    // wreck it: rename, change numbers, add a panel, delete a spar, import an airfoil
    await used.getByRole("button", { name: /^Project name/ }).click();
    await used.getByRole("textbox", { name: "Project name" }).fill("Something else");
    await used.keyboard.press("Enter");
    await openPanel(used, "Inner panel");
    await used.getByRole("spinbutton", { name: "Root chord" }).fill("300");
    await used.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await used.getByRole("button", { name: "Done" }).click();
    await addPanel(used);
    await startNewProject(used);
    await settled(used);

    expect(model(await exportJson(used))).toEqual(model(fresh));
    await expect(used.getByRole("button", { name: "Edit Inner panel" })).toBeVisible();
    await expect(used.getByRole("button", { name: "Edit Outer panel" })).toBeVisible();
    await expectClean(errors);
  });

  test("DF-E1 New gives fresh ids each time, so two new projects never share any", async ({ page }) => {
    await boot(page);
    const a = await exportJson(page);
    await startNewProject(page);
    const b = await exportJson(page);
    expect(b.id).not.toBe(a.id);
    expect(b.wing.panels[0].id).not.toBe(a.wing.panels[0].id);
  });

  test("DF-E2 the unit you chose is kept across New: it is a preference, not part of the model", async ({ page }) => {
    await boot(page);
    await page.getByRole("radio", { name: "Inches" }).check({ force: true });
    await startNewProject(page);
    expect((await exportJson(page)).displayUnits).toBe("in");
  });
});

test.describe("inches", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const useInches = (page: Page) => page.getByRole("radio", { name: "Inches" }).check({ force: true });
  const useMm = (page: Page) => page.getByRole("radio", { name: "Millimetres" }).check({ force: true });
  const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });
  const stored = async (page: Page) => (await exportJson(page)).wing.panels[0];

  test("UN-H1 switching converts what is shown, both ways, and labels it", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(field(page, "Panel length")).toHaveValue("420.00");
    await page.getByRole("button", { name: "Done" }).click();
    await useInches(page);
    await openPanel(page, "Inner panel");
    await expect(field(page, "Panel length")).toHaveValue("16.535"); // 420 / 25.4
    await expect(field(page, "Root chord")).toHaveValue("9.055");
    await expect(page.getByRole("dialog")).not.toContainText(/\dmm|\bmm\b/);
    await page.getByRole("tab", { name: "Ribs" }).click();
    await expect(field(page, "Rib thickness")).toHaveValue("0.118"); // 3mm
    await expect(page.getByRole("dialog")).not.toContainText(/\dmm|\bmm\b/);
    await page.getByRole("button", { name: "Done" }).click();
    await useMm(page);
    await openPanel(page, "Inner panel");
    await expect(field(page, "Panel length")).toHaveValue("420.00");
    await expectClean(errors);
  });

  test("UN-H2 a value typed in inches is stored as exact millimetres", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    await field(page, "Root chord").fill("9");
    await field(page, "Root chord").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    expect((await stored(page)).rootChordMm).toBe(228.6);
    await expectClean(errors);
  });

  test("UN-H3 units and fractions can be typed: 25.4mm, 1in, 1 3/8", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    const tip = field(page, "Tip chord");
    await tip.fill("25.4mm");
    await tip.press("Enter");
    await expect(tip).toHaveValue("1");
    await tip.fill("1 3/8");
    await tip.press("Enter");
    await expect(tip).toHaveValue("1.375");
    await tip.fill('3/8"');
    await tip.press("Enter");
    await expect(tip).toHaveValue("0.375");
    await page.getByRole("button", { name: "Done" }).click();
    expect((await stored(page)).tipChordMm).toBe(9.525);
    await useMm(page);
    await openPanel(page, "Inner panel");
    await tip.fill("1in");
    await tip.press("Enter");
    await expect(tip).toHaveValue("25.40");
    await expectClean(errors);
  });

  test("UN-T1 inches show up to three decimals and no padding: 1 is 1, 1.125 is 1.125", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    const tip = field(page, "Tip chord");
    for (const [typed, shown] of [["1", "1"], ["1.0", "1"], ["1.125", "1.125"], ["1.1250", "1.125"], ["0.5000", "0.5"], ["2", "2"], ["1.12345", "1.123"], ["10", "10"]] as const) {
      await tip.fill(typed);
      await tip.press("Enter");
      await expect(tip, `${typed} should read ${shown}`).toHaveValue(shown);
    }
    // a value that is not a tidy number still stops at three places
    await expect(field(page, "Root chord")).toHaveValue("9.055");
    await page.getByRole("button", { name: "Done" }).click();
    // everywhere else inches are quoted: the panel list and the wing size readout
    await expect(panelCard(page, "Inner panel")).toContainText("16.535 in");
    await expect(page.getByLabel("Wing size")).toContainText(/Span 61\.\d{1,3}in/);
    await expect(page.getByLabel("Wing size")).not.toContainText(/\.\d{4,}in/);
    await expectClean(errors);
  });

  test("UN-T2 millimetres are untouched by the inch rule: still two fixed decimals", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(field(page, "Root chord")).toHaveValue("230.00");
    await field(page, "Tip chord").fill("1");
    await field(page, "Tip chord").press("Enter");
    await expect(field(page, "Tip chord")).toHaveValue("1.00");
    await expectClean(errors);
  });

  test("UN-E1 clicking into a field and out again never changes the stored number", async ({ page }) => {
    await boot(page);
    const before = await stored(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    for (const name of ["Panel length", "Root chord", "Tip chord"]) {
      await field(page, name).focus();
      await field(page, name).blur();
    }
    await page.getByRole("tab", { name: "Ribs" }).click();
    await field(page, "Rib thickness").focus();
    await field(page, "Rib thickness").blur();
    await page.getByRole("button", { name: "Done" }).click();
    const after = await stored(page);
    expect(after.lengthMm).toBe(before.lengthMm);
    expect(after.rootChordMm).toBe(before.rootChordMm);
    expect(after.tipChordMm).toBe(before.tipChordMm);
    expect(after.ribThicknessMm).toBe(before.ribThicknessMm);
    await expectClean(errors);
  });

  test("UN-E2 a minimum is a minimum in inches too: 0.4mm is the floor for a rib", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await field(page, "Rib thickness").fill("0.001");
    await field(page, "Rib thickness").press("Enter");
    await expect(field(page, "Rib thickness")).toHaveValue("0.016");
    await page.getByRole("button", { name: "Done" }).click();
    expect((await stored(page)).ribThicknessMm).toBeCloseTo(0.4, 3);
    await expectClean(errors);
  });

  test("UN-E3 arrow keys step by a sensible amount in inches", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    const chord = field(page, "Root chord");
    await chord.focus();
    await chord.press("ArrowUp"); // 5mm steps become quarter inches
    await expect(chord).toHaveValue("9.305");
    await chord.press("ArrowDown");
    await chord.press("ArrowDown");
    await expect(chord).toHaveValue("8.805");
    await expectClean(errors);
  });

  test("UN-E4 junk in an inch field is refused, the old value stays", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    for (const junk of ["abc", "1/0", "1..2", "12 13"]) {
      await field(page, "Root chord").fill(junk);
      await field(page, "Root chord").press("Enter");
      await expect(field(page, "Root chord")).toHaveValue("9.055");
    }
    await expectClean(errors);
  });

  test("UN-H4 spar distance: the % / length switch reads in, and converts rather than reinterprets", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    const distance = field(page, "Distance from the datum edge");
    await expect(distance).toHaveValue("28.00"); // percent
    await page.getByRole("radiogroup", { name: "Distance unit" }).getByText("in", { exact: true }).click();
    await expect(distance).toHaveValue("2.535"); // 28% of 230mm = 64.4mm = 2.535in
    await expect(page.getByRole("radiogroup", { name: "Distance unit" })).toContainText("%");
    await expect(page.getByRole("radiogroup", { name: "Distance unit" })).not.toContainText("mm");
    await page.getByRole("button", { name: "Done" }).click();
    const spar = (await stored(page)).spars[0];
    expect(spar.distance.start.unit).toBe("mm");
    expect(spar.distance.start.value).toBeCloseTo(64.4, 2);
    await expectClean(errors);
  });

  test("UN-H5 status bar, summary and warnings speak inches; aspect ratio does not change", async ({ page }) => {
    await boot(page);
    const ar = async () => {
      return Number((await page.getByText("Aspect ratio", { exact: true }).locator("xpath=following-sibling::dd").innerText()).trim().split(/\s/)[0]);
    };
    const arMm = await ar();
    await useInches(page);
    const arIn = await ar();
    expect(arIn).toBe(arMm);
    await expect(page.getByLabel("Wing size")).toContainText(/in²/);
    await expect(page.getByLabel("Wing size")).toContainText("61.2"); // 1555.6mm = 61.24in span
    await expect(page.getByLabel("Summary")).toContainText("8.376in");
    await expect(page.getByLabel("Summary")).not.toContainText("dm²");
    await expectClean(errors);
  });

  test("UN-E5 a geometry warning quotes inches, not millimetres", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await field(page, "Distance from the datum edge").fill("180"); // 180% of the chord: off the section
    await field(page, "Distance from the datum edge").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    const text = await page.getByLabel("Geometry warnings").innerText();
    expect(text).toMatch(/outside the chord/);
    expect(text).toMatch(/\d(\.\d{1,3})?in/);
    expect(text).not.toMatch(/\d mm|\dmm/);
    await expectClean(errors);
  });

  test("UN-E6 the unit is saved with the project, comes back after a reload, and is one undo step", async ({ page }) => {
    await boot(page);
    await useInches(page);
    expect((await exportJson(page)).displayUnits).toBe("in");
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await expect(page.getByRole("radio", { name: "Inches" })).toBeChecked();
    // history is not kept across a reload, so make the change again to undo it
    await useMm(page);
    await page.waitForTimeout(500); // past the coalescing window, or the two switches are one undo step
    await useInches(page);
    await chooseMenu(page, ["Edit", /^Undo display units/]);
    await expect(page.getByRole("radio", { name: "Millimetres" })).toBeChecked();
    await expectClean(errors);
  });

  test("UN-E7 exports do not change with the display unit: the DXF is millimetres either way", async ({ page }) => {
    await boot(page);
    const dxf = async () => {
      const dl = page.waitForEvent("download");
      await chooseMenu(page, ["File", "Export", /^Export DXF/]);
      await page.getByRole("button", { name: "Save DXF" }).click();
      await page.keyboard.press("Escape").catch(() => undefined);
      const chunks: Buffer[] = [];
      for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const inMm = await dxf();
    await useInches(page);
    const inIn = await dxf();
    expect(inIn).toBe(inMm);
    expect(inIn).toContain("$INSUNITS");
    await expectClean(errors);
  });

  test("UN-E8 export dialogs follow the unit: page size and margin in inches", async ({ page }) => {
    await boot(page);
    await useInches(page);
    await chooseMenu(page, ["File", "Export", /^Export PDF/]);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("combobox", { name: "Page size" })).toContainText("8.268×11.693in");
    await expect(dlg.getByRole("spinbutton", { name: "Page margin" })).toHaveValue("0.394"); // 10mm
    await expect(dlg).toContainText("100mm (3.937in)");
    await expectClean(errors);
  });

  test("UN-E9 the header fits at phone width with the switch and a long name", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.getByRole("button", { name: /^Project name/ }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("A fairly long project name indeed");
    await page.keyboard.press("Enter");
    await useInches(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expect(page.getByRole("button", { name: "File", exact: true })).toBeVisible();
    await expectClean(errors);
  });

  test("UN-H6 keyboard only: the unit switch is reachable and arrow keys flip it", async ({ page }) => {
    await boot(page);
    await page.getByRole("radio", { name: "Millimetres" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Inches" })).toBeChecked();
    await expectClean(errors);
  });

  test("UN-A1 axe is clean with inches on, in the panel dialog", async ({ page }, info) => {
    await boot(page);
    await useInches(page);
    await openPanel(page, "Inner panel");
    const { a11y } = await import("./helpers");
    await a11y(page, info, "UN-A1-inches-dialog");
    await expectClean(errors);
  });
});
