/** Ribs: distributions, the planform overlay, the rib table, thickness, and building tabs as a feature. */
import { expect, test, type Page } from "@playwright/test";
import { boot, expectClean, exportProjectJson, guard, panelCard, ribCell, ribEdit, ribType } from "./helpers";

const builder = (page: Page) => page.getByRole("region", { name: "Simplified builder" });
const features = (page: Page) => builder(page).getByRole("navigation", { name: "Features" });
const openFeatures = async (page: Page, name = "Inner panel") => {
  await panelCard(page, name).getByRole("region", { name: new RegExp(`${name} features`) }).click();
  await expect(features(page)).toBeVisible();
};
/** The ribs live in the wing geometry view, under the planform. */
const openGeometry = async (page: Page, name = "Inner panel") => {
  await panelCard(page, name).getByRole("region", { name: new RegExp(`${name} planform`) }).click();
  await expect(section(page)).toBeVisible();
};
const section = (page: Page) => builder(page).getByRole("region", { name: "Ribs" });
/** Values are text until clicked: click, type, Enter. */
const edit = async (page: Page, what: string, field: string, value: string) => {
  await section(page).getByRole("button", { name: `Change ${what}`, exact: true }).click();
  const f = section(page).getByRole("spinbutton", { name: field });
  await f.fill(value);
  await f.press("Enter");
};
/** Pick a distribution from the menu on the Distribution value. */
const distribution = async (page: Page, label: string) => {
  await section(page).getByRole("button", { name: /^Distribution,/ }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
/** Equal or Custom thickness, from the gear beside the thickness value. */
const thickness = async (page: Page, label: "Equal" | "Custom") => {
  await section(page).getByRole("button", { name: "Thickness options" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
};
const ribs = async (page: Page, i = 0) => (await exportProjectJson(page)).wing.panels[i].ribs as { positionMm: number; thicknessMm: number; half?: string | null }[];
const gapsOf = (r: { positionMm: number }[]) => r.slice(1).map((x, i) => x.positionMm - r[i].positionMm);
const headers = async (page: Page) => (await section(page).getByRole("columnheader").allInnerTexts()).map((h) => h.toLowerCase().replace(/^./, (c) => c.toUpperCase()));

test.describe("Ribs in the wing geometry view", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("RB-H1 the ribs are drawn over the planform, their controls are in a section of their own under it; ribs are not a feature in the list", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const plan = builder(page).getByRole("region", { name: "Planform" });
    await expect(builder(page).getByRole("img", { name: /planform/ })).toHaveCount(1); // one drawing, not two
    await expect(plan.locator("[data-rib-line]")).toHaveCount(9);
    await expect(plan.getByRole("img", { name: /planform with its 9 ribs/ })).toBeVisible();
    // the ribs are a section of their own, under the planform section, not inside it
    await expect(plan.getByRole("region", { name: "Ribs" })).toHaveCount(0);
    const planBox = (await plan.boundingBox())!;
    const ribsBox = (await section(page).boundingBox())!;
    expect(ribsBox.y).toBeGreaterThanOrEqual(planBox.y + planBox.height - 1);
    // no sliders and no select: the distribution is a value, next to the thickness
    await expect(section(page).getByRole("slider")).toHaveCount(0);
    await expect(builder(page).getByRole("combobox", { name: "Rib distribution" })).toHaveCount(0);
    const thick = (await section(page).getByRole("button", { name: "Change rib thickness" }).boundingBox())!;
    const dist = (await section(page).getByRole("button", { name: /^Distribution,/ }).boundingBox())!;
    expect(Math.abs(dist.y - thick.y)).toBeLessThan(20);
    expect(dist.x).toBeGreaterThan(thick.x + thick.width);
    // not a feature any more
    await builder(page).getByRole("button", { name: "Features", exact: true }).click();
    await expect(features(page).locator('[data-feature-card="Ribs"]')).toHaveCount(0);
    await builder(page).getByRole("button", { name: "Close the builder" }).click();
    await expect(panelCard(page, "Inner panel").locator('[data-feature-chip="Ribs"]')).toHaveCount(0);
    await expectClean(errors);
  });

  test("RB-H2 rib thickness changes show: the stored value, the line weight on the planform, every rib", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const weight = () => builder(page).getByRole("region", { name: "Planform" }).locator("[data-rib-line]").first().evaluate((e) => parseFloat(getComputedStyle(e).strokeWidth));
    const before = await weight();
    await edit(page, "rib thickness", "Rib thickness", "6");
    expect((await ribs(page)).every((r) => r.thicknessMm === 6)).toBe(true);
    const thick = await weight();
    expect(thick).toBeGreaterThan(before * 1.5);
    await edit(page, "rib thickness", "Rib thickness", "1");
    expect(await weight()).toBeLessThan(thick);
    await expectClean(errors);
  });

  test("RB-H3 the distribution is linear unless you choose another, from a menu of four; the count is the panel's and follows it", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await expect(section(page).getByRole("button", { name: "Distribution, Linear" })).toBeVisible();
    expect((await exportProjectJson(page)).wing.panels[0].ribLayout?.distribution ?? "linear").toBe("linear");
    await section(page).getByRole("button", { name: /^Distribution,/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText([/^Linear/, /^Exponential/, /^Chord proportional/, /^Custom/]);
    // the inner panel has one chord, so there is nothing for chord proportional to follow
    await expect(page.getByRole("menuitem", { name: "Chord proportional" })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    const g0 = gapsOf(await ribs(page));
    for (const g of g0) expect(g).toBeCloseTo(g0[0], 2);
    await edit(page, "number of ribs", "Number of ribs", "5");
    let r = await ribs(page);
    expect(r).toHaveLength(5);
    expect(r[4].positionMm).toBe(420);
    await builder(page).getByRole("button", { name: "Change panel length" }).click();
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).fill("500");
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).press("Enter");
    r = await ribs(page);
    expect(r[4].positionMm).toBe(500);
    await expectClean(errors);
  });

  test("RB-H4 exponential shows its bias, from -3 to 3, and moves the ribs along the span", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await expect(section(page).getByRole("button", { name: "Change exponential bias" })).toHaveCount(0); // only with its option
    await distribution(page, "Exponential");
    await expect(section(page).getByRole("button", { name: "Change exponential bias" })).toContainText("0.0");
    await edit(page, "exponential bias", "Exponential bias", "2");
    let g = gapsOf(await ribs(page));
    expect(g[0]).toBeLessThan(g[g.length - 1]); // crowded toward the root
    expect((await ribs(page))[8].positionMm).toBe(420);
    await edit(page, "exponential bias", "Exponential bias", "-2");
    g = gapsOf(await ribs(page));
    expect(g[0]).toBeGreaterThan(g[g.length - 1]);
    await edit(page, "exponential bias", "Exponential bias", "9");
    await expect(section(page).getByRole("button", { name: "Change exponential bias" })).toContainText("3.0");
    // choosing another option takes its number away
    await distribution(page, "Linear");
    await expect(section(page).getByRole("button", { name: "Change exponential bias" })).toHaveCount(0);
    const g1 = gapsOf(await ribs(page));
    for (const g of g1) expect(g).toBeCloseTo(g1[0], 2);
    await expectClean(errors);
  });

  test("RB-H5 chord proportional shows its number, from -2 to 2, and is only on offer when the chords differ", async ({ page }) => {
    await boot(page);
    await openGeometry(page, "Outer panel");
    await distribution(page, "Chord proportional");
    await expect(section(page).getByRole("button", { name: "Change exponential bias" })).toHaveCount(0);
    await edit(page, "chord proportionality", "Chord proportionality", "1");
    let g = gapsOf(await ribs(page, 1));
    expect(g[0]).toBeGreaterThan(g[g.length - 1]); // closer where the chord is narrow
    const one = g[0] / g[g.length - 1];
    await edit(page, "chord proportionality", "Chord proportionality", "2");
    g = gapsOf(await ribs(page, 1));
    expect(g[0] / g[g.length - 1]).toBeGreaterThan(one);
    await edit(page, "chord proportionality", "Chord proportionality", "5");
    await expect(section(page).getByRole("button", { name: "Change chord proportionality" })).toContainText("2.0");
    // negative values go down to -2: further apart where the chord is narrow
    await edit(page, "chord proportionality", "Chord proportionality", "-1");
    g = gapsOf(await ribs(page, 1));
    expect(g[0]).toBeLessThan(g[g.length - 1]);
    await edit(page, "chord proportionality", "Chord proportionality", "-5");
    await expect(section(page).getByRole("button", { name: "Change chord proportionality" })).toContainText("-2.0");
    expect(await ribs(page, 1)).toHaveLength(8);
    await expectClean(errors);
  });

  test("RB-H6 the rib table is its own section: closed to begin with, openable on a linear layout, showing only positions and read only", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const toggle = section(page).getByRole("button", { name: /^Rib table/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(section(page).getByRole("table")).toHaveCount(0);
    await toggle.click();
    await expect(section(page).getByRole("table")).toBeVisible();
    await expect(section(page).getByRole("row")).toHaveCount(10); // header and nine ribs
    expect(await headers(page)).toEqual(["Rib", "Position"]); // thickness and type only when they vary
    await expect(section(page).getByRole("button", { name: /^Change Rib \d/ })).toHaveCount(0);
    await expect(section(page)).toContainText(/Choose Custom to change them/);
    await expectClean(errors);
  });

  test("RB-H6b the ribs, thickness and distribution values line up on one row with room between them, and the rib table has room above and compact rows", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const captions = ["Thickness", "Distribution"];
    const boxes = [];
    for (const c of captions) boxes.push((await section(page).getByText(c, { exact: true }).first().boundingBox())!);
    // the captions share a line, and each value starts well clear of the one before
    for (const b of boxes) expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(2);
    const values = [
      (await section(page).getByRole("button", { name: "Change number of ribs" }).boundingBox())!,
      (await section(page).getByRole("button", { name: "Change rib thickness" }).boundingBox())!,
      (await section(page).getByRole("button", { name: /^Distribution,/ }).boundingBox())!,
    ];
    for (let i = 1; i < values.length; i++) expect(values[i].x - (values[i - 1].x + values[i - 1].width)).toBeGreaterThanOrEqual(24);
    for (const v of values) expect(Math.abs(v.y + v.height / 2 - (values[0].y + values[0].height / 2))).toBeLessThan(8);
    // the table section is set apart from the controls above it
    const dist = values[2];
    const toggle = (await section(page).getByRole("button", { name: /^Rib table/ }).boundingBox())!;
    expect(toggle.y - (dist.y + dist.height)).toBeGreaterThanOrEqual(24);
    await section(page).getByRole("button", { name: /^Rib table/ }).click();
    const row = (await section(page).getByRole("row").nth(2).boundingBox())!;
    expect(row.height).toBeLessThanOrEqual(30);
    await expectClean(errors);
  });

  test("RB-H6c a linear layout shows the distance between ribs, and it follows the count and the length", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await expect(section(page)).toContainText("Spacing");
    await expect(section(page)).toContainText("52.5mm"); // 420 mm over 8 gaps
    await edit(page, "number of ribs", "Number of ribs", "5");
    await expect(section(page)).toContainText("105.0mm");
    await distribution(page, "Exponential");
    await expect(section(page).getByText("Spacing", { exact: true })).toHaveCount(0); // only a linear layout has one distance
    await expectClean(errors);
  });

  test("RB-H6d half ribs live in an Advanced section above the rib table, with a front half and a rear half, each with its own cut line", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const adv = section(page).getByRole("button", { name: "Advanced", exact: true });
    await expect(adv).toHaveAttribute("aria-expanded", "false");
    const table = (await section(page).getByRole("button", { name: /^Rib table/ }).boundingBox())!;
    expect((await adv.boundingBox())!.y).toBeLessThan(table.y);
    await adv.click();
    await expect(section(page).getByRole("region", { name: "Front half ribs" })).toHaveCount(0); // nothing until half ribs are on
    await section(page).getByRole("checkbox", { name: "Half ribs", exact: true }).check();
    const front = section(page).getByRole("region", { name: "Front half ribs" });
    const rear = section(page).getByRole("region", { name: "Rear half ribs" });
    await expect(front).toBeVisible();
    await expect(rear).toBeVisible();
    // the buttons for them are in these sections, not up in the table
    await expect(front.getByRole("button", { name: "Alternate front half ribs" })).toBeVisible();
    await expect(rear.getByRole("button", { name: "Alternate rear half ribs" })).toBeVisible();
    await expect(section(page).getByRole("table").getByRole("button", { name: /Alternate/ })).toHaveCount(0);
    // each has its own cut line, and the rear one starts out the same as the front
    await expect(front.getByRole("spinbutton", { name: "Front half cut line" })).toHaveValue(/35/);
    await expect(rear.getByRole("spinbutton", { name: "Rear half cut line" })).toHaveValue(/35/);
    await rear.getByRole("spinbutton", { name: "Rear half cut line" }).fill("60");
    await rear.getByRole("spinbutton", { name: "Rear half cut line" }).press("Enter");
    const p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.halfRibRearCutPct).toBe(60);
    expect(p.halfRibCutPct).toBe(35);
    // the rear half ribs alternate in, and the planform draws them from their own line
    await rear.getByRole("button", { name: "Alternate rear half ribs" }).click();
    const rearRibs = (await ribs(page)).filter((r) => r.half === "rear");
    expect(rearRibs.length).toBeGreaterThan(0);
    await expect(section(page).getByRole("button", { name: /^Rib table/ })).toHaveAttribute("aria-expanded", "true");
    await expect(section(page).getByRole("columnheader", { name: "Type" })).toBeVisible();
    await expectClean(errors);
  });

  test("RB-H12 a 3D view of the ribs sits above the Advanced section, and can be turned round with the mouse", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const view = section(page).locator("[data-ribs-viewport]");
    await expect(view).toBeVisible();
    await expect(view.locator("canvas")).toBeVisible();
    await expect(view).toHaveAttribute("data-rib-count", "9");
    const v = (await view.boundingBox())!;
    expect(v.height).toBeGreaterThanOrEqual(258); // 10% taller than it was (235)
    expect(v.width).toBeGreaterThan(300);
    // above Advanced, below the values
    const adv = (await section(page).getByRole("button", { name: "Advanced", exact: true }).boundingBox())!;
    const thick = (await section(page).getByRole("button", { name: "Change rib thickness" }).boundingBox())!;
    expect(v.y + v.height).toBeLessThanOrEqual(adv.y);
    expect(v.y).toBeGreaterThanOrEqual(thick.y + thick.height);
    // it follows the ribs
    await edit(page, "number of ribs", "Number of ribs", "5");
    await expect(view).toHaveAttribute("data-rib-count", "5");
    // and it turns: dragging changes what is drawn
    const shot = () => view.screenshot();
    await view.scrollIntoViewIfNeeded();
    const now = (await view.boundingBox())!;
    const before = await shot();
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2);
    await page.mouse.down();
    await page.mouse.move(now.x + now.width / 2 + 80, now.y + now.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const after = await shot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expectClean(errors);
  });

  test("RB-H13 in the table, values can be dragged left and right to move ribs and change thicknesses; there is no Change distribution button", async ({ page }) => {
    test.setTimeout(120_000); // many project exports in one walk
    await boot(page);
    await openGeometry(page);
    await distribution(page, "Custom");
    await thickness(page, "Custom");
    await expect(section(page).getByRole("button", { name: "Change distribution…" })).toHaveCount(0);
    const drag = async (label: string, dx: number) => {
      await ribCell(page, label).scrollIntoViewIfNeeded();
      const b = (await ribCell(page, label).boundingBox())!;
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
    };
    const before = await ribs(page);
    await drag("Rib 3 position", 30);
    await expect(section(page).getByRole("table").getByRole("spinbutton")).toHaveCount(0); // a drag is not a click
    expect((await ribs(page))[2].positionMm).toBeCloseTo(before[2].positionMm + 3, 3); // a millimetre every ten pixels
    await drag("Rib 3 position", -20);
    expect((await ribs(page))[2].positionMm).toBeCloseTo(before[2].positionMm + 1, 3);
    // a rib stops short of its neighbour rather than jumping past it
    await drag("Rib 3 position", 3000);
    const r = await ribs(page);
    expect(r[2].positionMm).toBeLessThan(r[3].positionMm);
    expect(r[2].positionMm).toBeGreaterThan(before[3].positionMm - 1);
    // thickness drags in half millimetres
    await drag("Rib 4 thickness", 10);
    expect((await ribs(page))[3].thicknessMm).toBe(3.5);
    // the first and last ribs stay on the ends of the panel
    await drag("Rib 1 position", -200);
    expect((await ribs(page))[0].positionMm).toBe(0);
    await expectClean(errors);
  });

  test("RB-H14 the 3D view turns about the centre of the panel section, and can be perspective or orthographic", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const view = section(page).locator("[data-ribs-viewport]");
    await view.scrollIntoViewIfNeeded();
    const pivot = async () => ((await view.getAttribute("data-pivot")) ?? "").split(",").map(Number);
    // the right wing: the ribs run along -z from 0 to the panel length (420 mm, a little less with the 2 degrees of
    // dihedral), so the middle is near -210
    const p0 = await pivot();
    expect(p0[2]).toBeLessThan(-195);
    expect(p0[2]).toBeGreaterThan(-225);
    // turning does not move the pivot
    const drag = async () => {
      const b = (await view.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 90, b.y + b.height / 2 + 20, { steps: 6 });
      await page.mouse.up();
    };
    await drag();
    expect(await pivot()).toEqual(p0);
    // changing the number of ribs does not move it either: the ends are still the ends
    await edit(page, "number of ribs", "Number of ribs", "5");
    await expect(view).toHaveAttribute("data-rib-count", "5");
    expect(await pivot()).toEqual(p0);
    // a longer panel moves the middle with it
    await builder(page).getByRole("button", { name: "Change panel length" }).click();
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).fill("600");
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).press("Enter");
    await view.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await pivot())[2]).toBeLessThan(-280);

    // perspective to start with; switch to orthographic and back, keeping the pivot, and the view still turns
    const switcher = section(page).getByRole("group", { name: "View" });
    await expect(switcher.getByRole("button", { name: "Perspective" })).toHaveAttribute("aria-pressed", "true");
    await expect(view).toHaveAttribute("data-projection", "perspective");
    const before = await pivot();
    const persp = await view.screenshot();
    await switcher.getByRole("button", { name: "Orthographic" }).click();
    await expect(view).toHaveAttribute("data-projection", "orthographic");
    await expect(switcher.getByRole("button", { name: "Orthographic" })).toHaveAttribute("aria-pressed", "true");
    expect(await pivot()).toEqual(before);
    const ortho = await view.screenshot();
    expect(Buffer.compare(persp, ortho)).not.toBe(0);
    await drag();
    expect(await pivot()).toEqual(before);
    const turned = await view.screenshot();
    expect(Buffer.compare(ortho, turned)).not.toBe(0);
    await switcher.getByRole("button", { name: "Perspective" }).click();
    await expect(view).toHaveAttribute("data-projection", "perspective");
    expect(await pivot()).toEqual(before);
    await expectClean(errors);
  });

  test("RB-H15 the 3D view always shows the original profiles; a light veil can be switched off; neither moves the camera", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    // give the ribs something to lose, so a modified view would differ from the original one: sheeting cuts every rib back
    await builder(page).getByRole("button", { name: "Features", exact: true }).click();
    await features(page).getByRole("button", { name: "Add a feature" }).click();
    await page.getByRole("dialog", { name: "Add a feature" }).getByRole("button", { name: /^Sheeting/ }).click(); // made at once
    await builder(page).getByRole("button", { name: "Wing geometry", exact: true }).click();
    const view = section(page).locator("[data-ribs-viewport]");
    await view.scrollIntoViewIfNeeded();
    // there is no switch between original and modified
    await expect(section(page).getByRole("group", { name: "Profiles", exact: true })).toHaveCount(0);
    await expect(section(page).getByRole("button", { name: "Modified" })).toHaveCount(0);
    await expect(section(page).getByRole("button", { name: "Original" })).toHaveCount(0);
    await expect(view).toHaveAttribute("data-veil", "1");
    // turn the view somewhere of our own first, so there is a camera worth keeping
    const box = (await view.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 - 25, { steps: 6 });
    await page.mouse.up();
    const camera = async () => [await view.getAttribute("data-camera"), await view.getAttribute("data-pivot")];
    const mine = await camera();
    expect(mine[0]).toBeTruthy();
    const withVeil = await view.screenshot();
    await section(page).getByRole("checkbox", { name: "Airfoil surface" }).uncheck();
    await expect(view).toHaveAttribute("data-veil", "0");
    expect(Buffer.compare(withVeil, await view.screenshot())).not.toBe(0);
    expect(await camera()).toEqual(mine);
    await section(page).getByRole("checkbox", { name: "Airfoil surface" }).check();
    await expect(view).toHaveAttribute("data-veil", "1");
    expect(await camera()).toEqual(mine);
    // nor does picking a rib, which only changes its colour
    await section(page).getByRole("button", { name: /^Rib table/ }).click();
    await section(page).getByRole("row", { name: /Rib 3/ }).click();
    expect(await camera()).toEqual(mine);
    // the view follows the ribs
    await edit(page, "number of ribs", "Number of ribs", "5");
    await expect(view).toHaveAttribute("data-rib-count", "5");
    await expectClean(errors);
  });

  test("RB-H16 the 3D view's controls sit at its corners, and half ribs show as they are defined", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const view = section(page).locator("[data-ribs-viewport]");
    await view.scrollIntoViewIfNeeded();
    const v = (await view.boundingBox())!;
    const projection = (await section(page).getByRole("group", { name: "View", exact: true }).boundingBox())!;
    const surface = (await section(page).locator("label", { hasText: "Airfoil surface" }).boundingBox())!;
    // Perspective / Orthographic: top right. Airfoil surface: bottom right.
    expect(v.x + v.width - (projection.x + projection.width)).toBeLessThan(30);
    expect(projection.y - v.y).toBeLessThan(30);
    expect(v.x + v.width - (surface.x + surface.width)).toBeLessThan(40);
    expect(v.y + v.height - (surface.y + surface.height)).toBeLessThan(40);

    const whole = await view.screenshot();
    // make every second rib a front half rib: the profiles follow
    await section(page).getByRole("button", { name: "Advanced", exact: true }).click();
    await section(page).getByRole("checkbox", { name: "Half ribs", exact: true }).check();
    await section(page).getByRole("button", { name: "Alternate front half ribs" }).click();
    await view.scrollIntoViewIfNeeded();
    const halves = await view.screenshot();
    expect(Buffer.compare(whole, halves)).not.toBe(0);
    // and putting them back to full changes the picture again
    await section(page).getByRole("button", { name: "Make all ribs full" }).click();
    await view.scrollIntoViewIfNeeded();
    expect(Buffer.compare(halves, await view.screenshot())).not.toBe(0);
    await expectClean(errors);
  });

  test("RB-H17 the whole panel is inside the 3D frame, whatever its shape, in both views, and still after it is made longer", async ({ page }) => {
    await boot(page);
    const orangeAtEdges = (shot: Buffer) =>
      page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const band = 4;
        const px = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data;
        let hits = 0;
        const orange = (d: Uint8ClampedArray) => d[0] > 150 && d[0] - d[2] > 70;
        // the rib colour must not touch the edges of the frame (the corners hold the controls, so the middle of each side)
        for (let i = Math.round(img.width * 0.2); i < img.width * 0.8; i += 3) for (const y of [0, band, img.height - 1 - band, img.height - 1]) if (orange(px(i, y))) hits++;
        for (let j = Math.round(img.height * 0.2); j < img.height * 0.8; j += 3) for (const x of [0, band, img.width - 1 - band, img.width - 1]) if (orange(px(x, j))) hits++;
        // and there is rib colour in the frame at all
        let inside = 0;
        for (let i = 0; i < img.width; i += 5) for (let j = 0; j < img.height; j += 5) if (orange(px(i, j))) inside++;
        return { hits, inside };
      }, shot.toString("base64"));

    for (const name of ["Inner panel", "Outer panel"]) {
      await openGeometry(page, name);
      const view = section(page).locator("[data-ribs-viewport]");
      await view.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      for (const kind of ["Perspective", "Orthographic"]) {
        await section(page).getByRole("group", { name: "View", exact: true }).getByRole("button", { name: kind }).click();
        await page.waitForTimeout(150);
        const r = await orangeAtEdges(await view.screenshot());
        expect(r.hits, `${name}, ${kind}: the ribs touch the edge of the frame`).toBe(0);
        expect(r.inside, `${name}, ${kind}: the ribs are in the frame`).toBeGreaterThan(20);
      }
      await builder(page).getByRole("button", { name: "Close the builder" }).click();
    }
    // a much longer panel is fitted again
    await openGeometry(page, "Inner panel");
    const view = section(page).locator("[data-ribs-viewport]");
    await builder(page).getByRole("button", { name: "Change panel length" }).click();
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).fill("900");
    await builder(page).getByRole("spinbutton", { name: "Panel length" }).press("Enter");
    await view.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const r = await orangeAtEdges(await view.screenshot());
    expect(r.hits, "a longer panel touches the edge of the frame").toBe(0);
    expect(r.inside).toBeGreaterThan(20);
    await expectClean(errors);
  });

  test("RB-H18 the rib preview is on the features half only, not under the wing geometry", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await expect(builder(page).getByLabel("Rib selector")).toHaveCount(0);
    await expect(builder(page).getByText(/^Rib preview/)).toHaveCount(0);
    await builder(page).getByRole("button", { name: "Features", exact: true }).click();
    await expect(builder(page).getByLabel("Rib selector")).toBeVisible();
    await expect(builder(page).getByText(/^Rib preview/)).toBeVisible();
    await builder(page).getByRole("button", { name: "Wing geometry", exact: true }).click();
    await expect(builder(page).getByLabel("Rib selector")).toHaveCount(0);
    await expectClean(errors);
  });

  test("RB-H19 in the distribution and thickness menus the current option is highlighted, in a different colour from hover", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const bg = (loc: ReturnType<Page["locator"]>) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
    // distribution: Linear to start with
    await section(page).getByRole("button", { name: /^Distribution,/ }).click();
    const current = page.getByRole("menuitem", { name: "Linear", exact: true });
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(current).toBeFocused(); // the menu opens on the current choice
    await expect(page.getByRole("menuitem", { name: "Exponential", exact: true })).not.toHaveAttribute("aria-current", "true");
    await expect(page.locator('[role="menuitem"][aria-current="true"]')).toHaveCount(1);
    const currentColour = await bg(current);
    const plain = page.getByRole("menuitem", { name: "Custom", exact: true });
    const plainColour = await bg(plain);
    expect(currentColour).not.toBe(plainColour);
    await plain.hover();
    const hoverColour = await bg(plain);
    expect(hoverColour).not.toBe(plainColour); // hover shows
    expect(hoverColour).not.toBe(currentColour); // and is not the colour of the current one
    // picking another moves the highlight
    await page.getByRole("menuitem", { name: "Exponential", exact: true }).click();
    await section(page).getByRole("button", { name: /^Distribution,/ }).click();
    await expect(page.getByRole("menuitem", { name: "Exponential", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("menuitem", { name: "Linear", exact: true })).not.toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    // thickness: Equal, then Custom
    await section(page).getByRole("button", { name: "Thickness options" }).click();
    await expect(page.getByRole("menuitem", { name: "Equal", exact: true })).toHaveAttribute("aria-current", "true");
    await page.getByRole("menuitem", { name: "Custom", exact: true }).click();
    await section(page).getByRole("button", { name: "Thickness options" }).click();
    await expect(page.getByRole("menuitem", { name: "Custom", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("menuitem", { name: "Equal", exact: true })).not.toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expectClean(errors);
  });

  test("RB-H7 Custom keeps the ribs, opens the table by itself, and position values are text until clicked", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    const before = await ribs(page);
    await distribution(page, "Custom");
    expect(await ribs(page)).toEqual(before);
    await expect(section(page).getByRole("button", { name: /^Rib table/ })).toHaveAttribute("aria-expanded", "true");
    expect(await headers(page)).toEqual(["Rib", "Position"]);
    await expect(section(page).getByRole("table").getByRole("spinbutton")).toHaveCount(0);
    await expect(section(page).getByRole("button", { name: "Change number of ribs" })).toHaveCount(0); // the table sets the count now
    await ribCell(page, "Rib 2 position").click();
    await expect(section(page).getByRole("spinbutton", { name: "Rib 2 position" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(section(page).getByRole("table").getByRole("spinbutton")).toHaveCount(0);
    await expectClean(errors);
  });

  test("RB-H8 anything changed in the table is marked in light orange, and goes when it is put back", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await distribution(page, "Custom");
    const marked = () => section(page).locator("td[data-changed]");
    await expect(marked()).toHaveCount(0);
    await ribEdit(page, "Rib 3 position", "77");
    expect((await ribs(page))[2].positionMm).toBe(77);
    await expect(marked()).toHaveCount(1);
    const colour = await marked().first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(colour).not.toBe("rgba(0, 0, 0, 0)");
    await expect(section(page).locator("[data-change-legend]")).toContainText("1 rib differs");
    // a thickness and a half rib are marked too
    await thickness(page, "Custom");
    await section(page).getByRole("button", { name: "Advanced", exact: true }).click();
    await section(page).getByRole("checkbox", { name: "Half ribs", exact: true }).check();
    await ribEdit(page, "Rib 4 thickness", "5");
    await ribType(page, 5, "front");
    await expect(marked()).toHaveCount(3);
    // putting a value back to what the layout gives removes the mark
    await ribEdit(page, "Rib 3 position", "105");
    await expect(marked()).toHaveCount(2);
    await expectClean(errors);
  });

  test("RB-H9 the gear beside thickness chooses Equal or Custom; Custom replaces the value and adds the column", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await section(page).getByRole("button", { name: "Thickness options" }).click();
    await expect(page.getByRole("menuitem")).toHaveText([/^Equal/, /^Custom/]);
    await page.keyboard.press("Escape");
    await thickness(page, "Custom");
    await expect(section(page).getByRole("button", { name: "Change rib thickness" })).toHaveCount(0);
    await expect(section(page)).toContainText("Custom");
    await expect(section(page).getByRole("button", { name: /^Rib table/ })).toHaveAttribute("aria-expanded", "true");
    expect(await headers(page)).toEqual(["Rib", "Position", "Thickness"]);
    // the positions are still the layout's, not the user's
    await expect(ribCell(page, "Rib 2 position")).toHaveCount(0);
    await ribEdit(page, "Rib 3 thickness", "4");
    expect((await ribs(page))[2].thicknessMm).toBe(4);
    await thickness(page, "Equal");
    await expect(section(page).getByRole("button", { name: "Change rib thickness" })).toBeVisible();
    expect((await ribs(page)).every((r) => r.thicknessMm === 3)).toBe(true);
    expect(await headers(page)).toEqual(["Rib", "Position"]);
    await expectClean(errors);
  });

  test("RB-H10 leaving Custom asks first; Cancel keeps the table's positions, Replace places the ribs again", async ({ page }) => {
    await boot(page);
    await openGeometry(page);
    await distribution(page, "Custom");
    await ribEdit(page, "Rib 2 position", "77");
    await distribution(page, "Linear");
    await page.getByRole("dialog", { name: "Replace the custom ribs?" }).getByRole("button", { name: "Cancel" }).click();
    expect((await ribs(page))[1].positionMm).toBe(77);
    await distribution(page, "Linear");
    await page.getByRole("dialog", { name: "Replace the custom ribs?" }).getByRole("button", { name: "Replace them" }).click();
    expect((await ribs(page))[1].positionMm).toBeCloseTo(52.5, 2);
    await expect(section(page).getByRole("button", { name: "Distribution, Linear" })).toBeVisible();
    await expectClean(errors);
  });

  test("RB-H11 the full panel window has the same options as a form, the table in its own section", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Edit Inner panel" }).click();
    const dlg = page.getByRole("dialog", { name: /Wing panel definition/ });
    await dlg.getByRole("tab", { name: "Ribs" }).click();
    const pick = dlg.getByRole("combobox", { name: "Rib distribution" });
    await expect(pick).toHaveValue("linear");
    expect(await pick.locator("option").allInnerTexts()).toEqual(["Linear", "Exponential", "Chord proportional", "Custom"]);
    await expect(dlg.getByRole("button", { name: "Generate ribs" })).toHaveCount(0);
    await expect(dlg.getByRole("spinbutton", { name: "Exponential bias" })).toHaveCount(0);
    await pick.selectOption("exponential");
    await expect(dlg.getByRole("spinbutton", { name: "Exponential bias" })).toBeVisible();
    await expect(dlg.getByRole("spinbutton", { name: "Number of ribs" })).toBeVisible();
    await expect(dlg.getByRole("table")).toHaveCount(0);
    await dlg.getByRole("button", { name: /^Rib table/ }).click();
    await expect(dlg.getByRole("table")).toBeVisible();
    await expectClean(errors);
  });
});

test.describe("Building tabs as a feature", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const add = async (page: Page, kind: string) => {
    await features(page).getByRole("button", { name: "Add a feature" }).click();
    const dlg = page.getByRole("dialog", { name: "Add a feature" });
    await dlg.getByRole("button", { name: new RegExp(`^${kind}`) }).click();
    if (kind === "Rib comb" || kind === "Joiner") await dlg.getByRole("button", { name: /^Add / }).click();
  };

  test("BT-H1 building tabs are added from the + like any feature, with a card showing what they add, and removed with the bin", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await expect(features(page).locator('[data-feature-card="Building tabs"]')).toHaveCount(0);
    await add(page, "Building tabs");
    const card = features(page).locator('[data-feature-card="Building tabs"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole("img", { name: /what this feature adds/ })).toHaveCount(2);
    await expect(builder(page).getByRole("checkbox", { name: /Add building tabs to every rib/ })).toHaveCount(0);
    expect((await exportProjectJson(page)).wing.panels[0].buildingTabs.enabled).toBe(true);
    await features(page).getByRole("button", { name: "Add a feature" }).click();
    await expect(page.getByRole("dialog", { name: "Add a feature" }).getByRole("button", { name: /^Building tabs/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await features(page).getByRole("button", { name: "Remove Building tabs" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].buildingTabs.enabled).toBe(false);
    await expectClean(errors);
  });
});
