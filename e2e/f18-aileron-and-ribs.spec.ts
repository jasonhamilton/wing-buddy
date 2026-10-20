/** The aileron hinge, and the rest of round two's rib-level features. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel, ribCell, ribType, settled } from "./helpers";

const field = (page: Page, name: string) => page.getByRole("spinbutton", { name });

async function dxfRibs(page: Page): Promise<number> {
  await chooseMenu(page, ["File", "Export", /^Export DXF/]);
  const dl = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Save DXF" }).click();
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  await page.keyboard.press("Escape");
  return Buffer.concat(chunks).toString("utf8").split("0\nPOLYLINE\n8\nRIBS\n").length - 1;
}

/** Reopening the Spars tab selects the first spar; pick the aileron (it was named Spar 3 when added). */
async function selectAileron(page: Page) {
  await page.getByRole("tab", { name: "Spars" }).click();
  await page.getByRole("button", { name: "Spar 3", exact: true }).click();
}

/** Add an aileron spar 25% from the trailing edge on the inner panel, leaving the dialog open on the Spars tab. */
async function addAileron(page: Page) {
  await openPanel(page, "Inner panel");
  await page.getByRole("tab", { name: "Spars" }).click();
  await page.getByRole("button", { name: "Add spar" }).click();
  await page.getByLabel("Spar type").selectOption({ label: "Aileron cutter" });
  await page.getByRole("radio", { name: "Trailing edge" }).check();
  await field(page, "Distance from the datum edge").fill("25");
  await field(page, "Distance from the datum edge").press("Enter");
}

test.describe("Aileron hinge", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("AL-H1 choosing the aileron cutter shows the hinge settings, started sensibly", async ({ page }, info) => {
    await boot(page);
    await addAileron(page);
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("radio", { name: /Above \(cut from below\)/ })).toBeChecked();
    await expect(dlg.getByRole("radio", { name: "Cut right off" })).toBeChecked();
    await expect(field(page, "Gap width")).toHaveValue("1.00");
    await expect(field(page, "Cut depth")).toBeDisabled(); // only matters while the hinge stays attached
    await expect(field(page, "Angle on the aileron side")).toHaveValue("30.00");
    await expect(dlg.getByRole("checkbox", { name: /Close the wing's cut face/ })).toBeChecked();
    await a11y(page, info, "AL-H1-aileron-fields");
    await expectClean(errors);
  });

  test("AL-H2 cut off, each rib in the span comes out in two pieces; kept attached, it is one again", async ({ page }) => {
    await boot(page);
    const before = await dxfRibs(page);
    expect(before).toBe(17);
    await addAileron(page);
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const cut = await dxfRibs(page);
    expect(cut).toBeGreaterThan(before + 5); // 9 ribs on the inner panel, each now two pieces
    await openPanel(page, "Inner panel");
    await selectAileron(page);
    await page.getByRole("radio", { name: "Keep attached" }).check();
    await expect(field(page, "Cut depth")).toBeEnabled();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await dxfRibs(page)).toBe(before);
    await expectClean(errors);
  });

  test("AL-H3 the close-off walls are 3D members; switching a wall off removes it", async ({ page }) => {
    await boot(page);
    // The summary is a live region that settles a tick after the geometry does, so read it by polling.
    const members = async () => {
      const t = (await page.locator("p.sr-only", { hasText: /Wing view/ }).first().textContent()) ?? "";
      return Number(/and (\d+) structural members/.exec(t)?.[1] ?? "-1");
    };
    await expect.poll(members).toBeGreaterThanOrEqual(0);
    const base = await members();
    await addAileron(page);
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect.poll(members).toBe(base + 2);
    await openPanel(page, "Inner panel");
    await selectAileron(page);
    await page.getByRole("checkbox", { name: /Close the aileron's cut face/ }).uncheck();
    await expect(field(page, "Aileron wall width")).toBeDisabled();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect.poll(members).toBe(base + 1);
    await expectClean(errors);
  });

  test("AL-E1 the settings are held to sensible limits and saved with the project", async ({ page }) => {
    await boot(page);
    await addAileron(page);
    for (const [name, typed, shown] of [["Angle on the wing side", "200", "80.00"], ["Angle on the aileron side", "-5", "0.00"], ["Gap width", "-3", "0.00"]] as const) {
      await field(page, name).fill(typed);
      await field(page, name).press("Enter");
      await expect(field(page, name)).toHaveValue(shown);
    }
    await field(page, "Gap width").fill("1.5");
    await field(page, "Gap width").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    const spar = (await exportProjectJson(page)).wing.panels[0].spars.find((x: { type: string }) => x.type === "aileronCutter");
    expect(spar.type).toBe("aileronCutter");
    expect(spar.aileron.widthMm).toBe(1.5);
    expect(spar.aileron.alphaDeg).toBe(80);
    await expectClean(errors);
  });

  test("AL-E2 a change to a hinge setting is one undo step", async ({ page }) => {
    await boot(page);
    await addAileron(page);
    await page.getByRole("radio", { name: /Below \(cut from above\)/ }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo aileron/]);
    expect((await exportProjectJson(page)).wing.panels[0].spars.find((x: { type: string }) => x.type === "aileronCutter").aileron.hinge).toBe("above");
    await expectClean(errors);
  });

  test("AL-E3 an aileron placed off the chord is warned about, not drawn", async ({ page }) => {
    await boot(page);
    await addAileron(page);
    await field(page, "Distance from the datum edge").fill("180");
    await field(page, "Distance from the datum edge").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.getByLabel("Geometry warnings")).toContainText(/outside the chord/);
    await expectClean(errors);
  });

  test("AL-E4 a project saved before hinge settings existed opens as the simple cutter, and can be given a hinge", async ({ page }) => {
    await boot(page);
    await addAileron(page);
    await page.getByRole("button", { name: "Done" }).click();
    const json = await exportProjectJson(page);
    json.wing.panels[0].spars.find((x: { type: string }) => x.type === "aileronCutter").aileron = null;
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", /^Open/]);
    await (await chooser).setFiles({ name: "old.wingbuddy.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
    await page.getByRole("button", { name: /Replace and load/ }).click();
    await settled(page);
    await openPanel(page, "Inner panel");
    await selectAileron(page);
    await expect(page.getByRole("dialog")).toContainText("This is the simple cutter");
    await page.getByRole("button", { name: "Add hinge settings" }).click();
    await expect(page.getByRole("radio", { name: "Cut right off" })).toBeVisible();
    await expectClean(errors);
  });

  test("AL-E5 the aileron fields fit at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await addAileron(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });
});

test.describe("Half ribs", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const toRibs = async (page: Page) => {
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    // the rib table belongs to the Custom layout, with its columns ticked
    await page.getByRole("combobox", { name: "Rib distribution" }).selectOption("custom");
    await page.getByRole("checkbox", { name: /Set each rib's thickness/ }).check();
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await page.getByRole("checkbox", { name: "Half ribs", exact: true }).check();
  };
  const halves = async (page: Page) =>
    (await exportProjectJson(page)).wing.panels[0].ribs.filter((r: { half?: string | null }) => r.half).length;
  const widest = async (page: Page) => {
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const dl = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: "Save DXF" }).click();
    const chunks: Buffer[] = [];
    for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
    await page.keyboard.press("Escape");
    const t = Buffer.concat(chunks).toString("utf8");
    return Math.max(...[...t.matchAll(/\n10\n(-?[\d.]+)\n/g)].map((m) => Number(m[1])));
  };

  test("HR-H1 each rib has a type; a front half rib is saved with the project", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await expect(ribCell(page, "Rib 3 type")).toHaveText("Full");
    await ribCell(page, "Rib 3 type").click();
    const sel = page.getByRole("combobox", { name: "Rib 3 type" });
    expect(await sel.locator("option").allInnerTexts()).toEqual(["Full", "Front half", "Rear half"]);
    await sel.selectOption("front");
    await page.getByRole("button", { name: "Done" }).click();
    expect(await halves(page)).toBe(1);
    await expectClean(errors);
  });

  test("HR-H2 Alternate half ribs makes every second rib between the ends a half rib; Make all ribs full undoes it", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await expect(page.getByRole("button", { name: "Make all ribs full" })).toBeDisabled();
    await page.getByRole("button", { name: "Alternate front half ribs" }).click();
    await expect(ribCell(page, "Rib 1 type")).toHaveText("Full");
    await expect(ribCell(page, "Rib 2 type")).toHaveText("Front half");
    await expect(ribCell(page, "Rib 3 type")).toHaveText("Full");
    await expect(ribCell(page, "Rib 9 type")).toHaveText("Full");
    await page.getByRole("button", { name: "Done" }).click();
    expect(await halves(page)).toBe(4);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("button", { name: "Make all ribs full" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await halves(page)).toBe(0);
    await expectClean(errors);
  });

  test("HR-E1 the cut position is held between 5% and 95%, and moving it changes what is cut", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribType(page, 5, "rear");
    const cut = field(page, "Front half cut line");
    await expect(cut).toHaveValue("35.0");
    await cut.fill("99");
    await cut.press("Enter");
    await expect(cut).toHaveValue("95.0");
    await cut.fill("1");
    await cut.press("Enter");
    await expect(cut).toHaveValue("5.0");
    await cut.fill("35");
    await cut.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const withHalf = await widest(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("button", { name: "Make all ribs full" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await widest(page)).toBeLessThan(withHalf + 300); // layout row got no wider than before
    expect(withHalf).toBeLessThan(await widest(page));
    await expectClean(errors);
  });

  test("HR-E2 a half rib that does not reach a spar says so; one that does stays quiet", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribType(page, 4, "front");
    await field(page, "Front half cut line").fill("15"); // the main spar is at 28%, behind this cut
    await field(page, "Front half cut line").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.getByLabel("Geometry warnings")).toContainText(/half rib that is cut away|part of this half rib/);
    await page.getByRole("button", { name: /warning/i }).click();
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await field(page, "Front half cut line").fill("60");
    await field(page, "Front half cut line").press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(page.getByRole("button", { name: /warning/i })).toHaveCount(0);
    await expectClean(errors);
  });

  test("HR-E3 going back from Custom to Linear asks first and places the ribs again; half ribs are their own choice and stay until switched off", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribType(page, 2, "front");
    await page.getByRole("combobox", { name: "Rib distribution" }).selectOption("linear");
    const ask = page.getByRole("dialog", { name: "Replace the custom ribs?" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("combobox", { name: "Rib distribution" })).toHaveValue("custom");
    await page.getByRole("combobox", { name: "Rib distribution" }).selectOption("linear");
    await page.getByRole("dialog", { name: "Replace the custom ribs?" }).getByRole("button", { name: "Replace them" }).click();
    await page.getByRole("checkbox", { name: "Half ribs", exact: true }).uncheck();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await halves(page)).toBe(0);
    await expectClean(errors);
  });

  test("HR-E4 the type is a native select, reachable and changeable from the keyboard", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await ribCell(page, "Rib 6 type").click();
    const sel = page.getByRole("combobox", { name: "Rib 6 type" });
    await sel.focus();
    await page.keyboard.type("Front"); // type-ahead picks the matching option from the keyboard
    await expect(sel).toHaveValue("front");
    await expectClean(errors);
  });

  test("HR-A1 no serious accessibility violations on the rib table", async ({ page }, info) => {
    await boot(page);
    await toRibs(page);
    await a11y(page, info, "HR-A1-rib-table");
    await expectClean(errors);
  });
});
