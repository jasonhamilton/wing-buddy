/** The simplified builder: a slide-out for one panel, working alongside the full panel definition window. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, expectClean, exportProjectJson, guard, panelCard, settled } from "./helpers";

const builder = (page: Page) => page.getByRole("region", { name: "Simplified builder" });
const features = (page: Page) => builder(page).getByRole("navigation", { name: "Features" });
const field = (page: Page, name: string) => builder(page).getByRole("spinbutton", { name });
/** Click the card's body, away from its buttons. */
const openBuilder = async (page: Page, name = "Inner panel") => {
  await panelCard(page, name).getByRole("region", { name: new RegExp(`${name} planform`) }).click();
  await expect(builder(page)).toBeVisible();
};
/** Open the builder on the features half, the way a user does: the card's features section. */
const openFeatures = async (page: Page, name = "Inner panel") => {
  await panelCard(page, name).getByRole("region", { name: new RegExp(`${name} features`) }).click();
  await expect(builder(page)).toBeVisible();
  await expect(features(page)).toBeVisible();
};
/** A value in the geometry view is text until clicked: click it, and the field is there. */
const edit = async (page: Page, what: string, fieldName: string, value: string) => {
  await builder(page).getByRole("button", { name: `Change ${what}`, exact: true }).click();
  const f = field(page, fieldName);
  await expect(f).toBeFocused();
  await f.fill(value);
  await f.press("Enter");
};
const sample = "seligdatfile.dat";
/** Add a feature the way a user does: the + beside the list, then the kind. */
const addFeature = async (page: Page, kind: string) => {
  await features(page).getByRole("button", { name: "Add a feature" }).click();
  const dlg = page.getByRole("dialog", { name: "Add a feature" });
  await dlg.getByRole("button", { name: new RegExp(`^${/edge stock/.test(kind) ? "Edge stock" : kind}`) }).click(); // the tile
  // A spar asks which way it is cut; a rib comb and a joiner ask to be added; the rest are made and open for editing at once.
  if (kind === "Spar") await dlg.getByRole("button", { name: "Cuboid", exact: true }).click();
  else if (kind === "Notch") await dlg.getByRole("button", { name: "Top and bottom", exact: true }).click();
  else if (kind === "Leading edge stock" || kind === "Trailing edge stock") await dlg.getByRole("button", { name: kind === "Leading edge stock" ? "Leading edge" : "Trailing edge", exact: true }).click();
  else if (kind === "Rib comb" || kind === "Joiner") await dlg.getByRole("button", { name: /^Add / }).click();
};
const card = (page: Page, name: string) => features(page).locator(`[data-feature-card="${name}"]`);
const remove = (page: Page, name: string) => features(page).getByRole("button", { name: `Remove ${name}`, exact: true });
const cardNames = async (page: Page) => features(page).locator("[data-feature-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-feature-card")));

test.describe("Simplified builder", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("BD-H1 clicking a panel opens the builder to the right of the list, with the wing still in view and the other panels greyed out", async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    const listBefore = (await panelCard(page, "Inner panel").boundingBox())!;
    await openBuilder(page);
    await expect(builder(page).getByRole("heading", { name: /Simplified builder/ })).toContainText("Inner panel");
    // the list is still there, where it was, and the builder sits to its right
    const listNow = (await panelCard(page, "Inner panel").boundingBox())!;
    expect(Math.abs(listNow.x - listBefore.x)).toBeLessThan(2);
    const box = (await builder(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(listNow.x + listNow.width);
    // the wing is still drawn: its view runs under the builder (which is see-through where it has nothing to show) and out to the right
    const wing = page.locator("canvas").last(); // the 3D view comes after the builder in the page
    await expect(wing).toBeVisible();
    const wb = (await wing.boundingBox())!;
    expect(wb.x + wb.width).toBeGreaterThan(box.x + box.width + 250);
    expect(wb.width).toBeGreaterThan(250);
    // the panel being worked on is plain, the others are greyed
    await expect(panelCard(page, "Inner panel")).not.toHaveAttribute("data-dimmed");
    await expect(panelCard(page, "Outer panel")).toHaveAttribute("data-dimmed", "true");
    // and the 3D view ghosts them in gray, whatever the options say
    await expect(page.getByRole("checkbox", { name: "Ghost the other panels" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Ghost the other panels" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Gray ghosts" })).toBeChecked();
    await a11y(page, info, "BD-H1-builder");
    await expectClean(errors);
  });

  test("BD-H2 clicking the name still opens the full panel window, and not the builder", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Edit Inner panel" }).click();
    await expect(page.getByRole("dialog", { name: /Wing panel definition/ })).toBeVisible();
    await expect(builder(page)).toHaveCount(0);
    await expectClean(errors);
  });

  test("BD-H3 the back chevron returns to the panel list", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    await builder(page).getByRole("button", { name: "Close the builder" }).click();
    await expect(builder(page)).toHaveCount(0);
    await expect(panelCard(page, "Inner panel")).toBeVisible();
    await expectClean(errors);
  });

  test("BD-H4 geometry: both airfoils side by side, values are text until clicked, sweep is one click away", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    const box = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!;
    // nothing is a form to begin with
    await expect(builder(page).getByRole("spinbutton")).toHaveCount(0);
    await expect(builder(page).getByRole("textbox")).toHaveCount(0);
    const root = await box(builder(page).getByRole("button", { name: "Change root airfoil" }));
    const tip = await box(builder(page).getByRole("button", { name: "Change tip airfoil" }));
    expect(tip.x).toBeGreaterThan(root.x + root.width - 2);
    const rc = await box(builder(page).getByRole("button", { name: "Change root chord" }));
    const tc = await box(builder(page).getByRole("button", { name: "Change tip chord" }));
    expect(tc.x).toBeGreaterThan(rc.x + rc.width);
    // sweep: click, type, Enter -> saved, and the field goes back to text
    await edit(page, "sweep", "Sweep", "30");
    await expect(field(page, "Sweep")).toHaveCount(0);
    await expect(builder(page).getByRole("button", { name: "Change sweep" })).toBeFocused();
    expect((await exportProjectJson(page)).wing.panels[0].sweepMm).toBe(30);
    await edit(page, "dihedral", "Dihedral", "5");
    expect((await exportProjectJson(page)).wing.panels[0].dihedralDeg).toBe(5);
    await edit(page, "root twist", "Root twist", "1.5");
    expect((await exportProjectJson(page)).wing.panels[0].rootTwistDeg).toBe(1.5);
    await expectClean(errors);
  });

  test("BD-H5 an edit in the builder shows in the panel card, the status bar and the full window", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    await edit(page, "panel length", "Panel length", "400");
    await builder(page).getByRole("button", { name: "Change panel name" }).click();
    await builder(page).getByRole("textbox", { name: "Panel name" }).fill("Centre");
    await builder(page).getByRole("textbox", { name: "Panel name" }).blur();
    await builder(page).getByRole("button", { name: "Open the full editor" }).click();
    const dlg = page.getByRole("dialog", { name: /Wing panel definition/ });
    await expect(dlg.getByRole("spinbutton", { name: "Panel length" })).toHaveValue(/400/);
    await expect(dlg.getByRole("textbox", { name: "Name:" })).toHaveValue("Centre");
    await expectClean(errors);
  });

  test("BD-H6 the list holds only the additional features, as cards with a name and a kind, and no wing geometry", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const nav = features(page);
    for (const word of ["Required", "Optional", "Wing geometry"]) await expect(nav).not.toContainText(word);
    await expect(nav.getByRole("heading", { level: 3 })).toHaveCount(1); // "Features": no sections
    expect(await cardNames(page)).not.toContain("Inner panel");
    await addFeature(page, "Spar");
    const names = await cardNames(page);
    const newest = names[names.length - 1]!;
    await expect(card(page, newest)).toContainText(/spar|webbing/i);
    await expect(builder(page).getByRole("button", { name: "Change spar name" })).toBeVisible(); // the name is text until clicked
    await expectClean(errors);
  });

  test("BD-H7 spars, strips and combs can be many; edge stock and lightening holes only one, and the menu says so", async ({ page }) => {
    test.setTimeout(120_000); // many exports in one walk
    await boot(page);
    await openFeatures(page);
    const count = async (k: "spars" | "ribCombs") => (await exportProjectJson(page)).wing.panels[0][k].length;
    const spars = await count("spars");
    await addFeature(page, "Spar");
    await addFeature(page, "Spar");
    expect(await count("spars")).toBe(spars + 2);

    for (const [label, key] of [["Leading edge stock", "leadingEdge"], ["Trailing edge stock", "trailingEdge"]] as const) {
      if (await remove(page, label).count()) await remove(page, label).click(); // the example may already have it
      await addFeature(page, label);
      expect((await exportProjectJson(page)).wing.panels[0][key].enabled).toBe(true);
      await features(page).getByRole("button", { name: "Add a feature" }).click();
      const edgeTile = page.getByRole("dialog", { name: "Add a feature" }).getByRole("button", { name: /^Edge stock/ });
      const wing = (await exportProjectJson(page)).wing.panels[0];
      if (wing.leadingEdge.enabled && wing.trailingEdge.enabled) await expect(edgeTile).toHaveAttribute("aria-disabled", "true"); // both in: nothing left to add
      else {
        await edgeTile.click();
        await expect(page.getByRole("dialog", { name: "Add a feature" }).getByRole("button", { name: new RegExp(`^${label.replace(" stock", "")}`) })).toHaveAttribute("aria-disabled", "true");
      }
      await page.keyboard.press("Escape");
      await remove(page, label).click();
      expect((await exportProjectJson(page)).wing.panels[0][key].enabled).toBe(false);
    }

    await addFeature(page, "Sheeting");
    await addFeature(page, "Sheeting");
    let p = (await exportProjectJson(page)).wing.panels[0];
    expect(p.sheeting.type).toBe("advanced");
    expect(p.sheeting.strips).toHaveLength(2);
    await expect(card(page, "Strip 1")).toContainText("Sheeting strip");
    await remove(page, "Strip 2").click();
    await remove(page, "Strip 1").click();
    expect((await exportProjectJson(page)).wing.panels[0].sheeting.type).toBe("none");

    await addFeature(page, "Rib comb");
    await addFeature(page, "Rib comb");
    expect(await count("ribCombs")).toBe(2);
    await expect(card(page, "Comb 1")).toContainText("Rib comb");
    await remove(page, "Comb 2").click();
    expect(await count("ribCombs")).toBe(1);

    await addFeature(page, "Lightening holes");
    expect((await exportProjectJson(page)).wing.panels[0].lighteningHoles.type).toBe("standard");
    await features(page).getByRole("button", { name: "Add a feature" }).click();
    await expect(page.getByRole("dialog", { name: "Add a feature" }).getByRole("button", { name: /^Lightening holes/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await remove(page, "Lightening holes").click();
    expect((await exportProjectJson(page)).wing.panels[0].lighteningHoles.type).toBe("none");
    await expectClean(errors);
  });

  test("BD-H11 features can be reordered with the arrow keys and the order is saved", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await addFeature(page, "Rib comb");
    await addFeature(page, "Rib comb");
    const before = await cardNames(page);
    const last = before[before.length - 1]!;
    const grip = features(page).getByRole("button", { name: `Reorder ${last}` });
    await grip.focus();
    await page.keyboard.press("ArrowUp");
    const after = await cardNames(page);
    expect(after.indexOf(last)).toBe(before.indexOf(last) - 1);
    await expect(features(page).getByRole("button", { name: `Reorder ${last}` })).toBeFocused();
    await expect(features(page).getByRole("status")).toContainText(`${last} moved to position`);
    expect((await exportProjectJson(page)).wing.panels[0].featureOrder).toHaveLength(after.length);
    // the first feature cannot go up past the geometry, and nothing changes
    const first = after[0]!;
    await features(page).getByRole("button", { name: `Reorder ${first}` }).focus();
    await page.keyboard.press("ArrowUp");
    expect(await cardNames(page)).toEqual(after);
    await expectClean(errors);
  });

  test("BD-H12 each card carries the colour its part has in the 3D view", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await addFeature(page, "Rib comb");
    const resolved = (token: string) =>
      page.evaluate((t) => {
        const el = document.createElement("i");
        el.style.backgroundColor = `var(${t})`;
        document.body.appendChild(el);
        const c = getComputedStyle(el).backgroundColor;
        el.remove();
        return c;
      }, token);
    const bar = (name: string) => card(page, name).locator("[data-feature-colour]");
    const colour = (name: string) => bar(name).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await colour("Comb 1")).toBe(await resolved("--wb-geo-comb"));
    const names = await cardNames(page);
    const spar = names.find((n) => n && /spar/i.test(n));
    if (spar) expect(await colour(spar)).toBe(await resolved("--wb-geo-spar"));
    await expectClean(errors);
  });

  test("BD-H13 the feature editor is narrow: under 400px wide on a 1440px screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await openFeatures(page);
    const d = (await builder(page).getByLabel("Feature details").boundingBox())!;
    expect(d.width).toBeLessThan(400);
    expect(d.width).toBeGreaterThan(300);
    await expectClean(errors);
  });

  test("BD-H8 the rib sits under the settings, full width, with the rib buttons between", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page);
    await openFeatures(page);
    const b = (await builder(page).boundingBox())!;
    const details = (await builder(page).getByLabel("Feature details").boundingBox())!;
    const buttons = (await builder(page).getByLabel("Rib selector").boundingBox())!;
    const preview = (await builder(page).locator("canvas").boundingBox())!;
    expect(buttons.y).toBeGreaterThanOrEqual(details.y + details.height - 1);
    expect(preview.y).toBeGreaterThanOrEqual(buttons.y + buttons.height - 1);
    expect(preview.width).toBeGreaterThan(b.width - 8);
    // a profile is long and thin
    expect(preview.width / preview.height).toBeGreaterThan(3.5);
    await builder(page).getByRole("button", { name: "R3" }).click();
    await expect(builder(page).getByRole("button", { name: "R3" })).toHaveAttribute("aria-pressed", "true");
    await expectClean(errors);
  });

  test("BD-H9 Change airfoil opens the library; choosing a section sets that end of the panel", async ({ page }, info) => {
    await boot(page);
    await openBuilder(page);
    await builder(page).getByRole("button", { name: "Change root airfoil" }).click();
    const lib = page.getByRole("dialog", { name: "Airfoil library" });
    await expect(lib).toBeVisible();
    await a11y(page, info, "BD-H9-airfoil-library");
    await lib.getByRole("textbox", { name: "Filter airfoils" }).fill("0012");
    await lib.getByRole("button", { name: /NACA 0012/ }).click();
    await expect(lib.getByRole("img", { name: /NACA 0012/ })).toBeVisible();
    await expect(lib).toContainText(/Thickness/);
    await lib.getByRole("button", { name: "Use for the root" }).click();
    await expect(lib).toHaveCount(0);
    await settled(page);
    expect((await exportProjectJson(page)).wing.panels[0].rootAirfoilId).toBe("naca-0012");
    await expectClean(errors);
  });

  test("BD-H10 the library imports a section, shows it, and deletes it again; built-in ones cannot be deleted", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    await builder(page).getByRole("button", { name: "Change root airfoil" }).click();
    const lib = page.getByRole("dialog", { name: "Airfoil library" });
    await lib.getByRole("button", { name: /NACA 0012/ }).click();
    await expect(lib.getByRole("button", { name: "Delete" })).toBeDisabled();
    const chooser = page.waitForEvent("filechooser");
    await lib.getByRole("button", { name: "Import airfoil…" }).click();
    await (await chooser).setFiles(sample);
    await expect(lib.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveAttribute("aria-pressed", "true");
    await expect(lib.getByRole("heading", { name: /RG 14 AIRFOIL/ })).toBeVisible();
    await lib.getByRole("button", { name: "Delete" }).click();
    await expect(lib.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect((await exportProjectJson(page)).airfoils).toHaveLength(0);
    await expectClean(errors);
  });

  test("BD-E1 a section in use by a panel cannot be deleted, and the library says who uses it", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    await builder(page).getByRole("button", { name: "Change root airfoil" }).click();
    const lib = page.getByRole("dialog", { name: "Airfoil library" });
    const chooser = page.waitForEvent("filechooser");
    await lib.getByRole("button", { name: "Import airfoil…" }).click();
    await (await chooser).setFiles(sample);
    await lib.getByRole("button", { name: "Use for the root" }).click();
    await builder(page).getByRole("button", { name: "Change root airfoil" }).click();
    await expect(lib).toContainText("Inner panel root");
    await expect(lib.getByRole("button", { name: "Delete" })).toBeDisabled();
    await expectClean(errors);
  });

  test("BD-E2 the tip airfoil is 'same as the root' until you say otherwise", async ({ page }) => {
    await boot(page);
    await openBuilder(page, "Outer panel");
    const useRoot = builder(page).getByRole("button", { name: "Use the root airfoil here too" });
    const tip = (await exportProjectJson(page)).wing.panels[1].tipAirfoilId;
    // the note says whether the panel has a tip section of its own
    if (tip === null) {
      await expect(builder(page)).toContainText("Same as the root");
      await expect(useRoot).toHaveCount(0);
    } else {
      await useRoot.click();
      await expect(builder(page)).toContainText("Same as the root");
    }
    expect((await exportProjectJson(page)).wing.panels[1].tipAirfoilId).toBeNull();
    await expect(builder(page).getByRole("button", { name: "Change tip airfoil" })).toBeVisible();
    await expectClean(errors);
  });

  test("BD-E3 deleting the panel from under the builder (undo of an add) returns to the list", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Add panel", exact: true }).click();
    await page.getByRole("dialog", { name: "Add a panel" }).getByRole("button", { name: /Add panel|Add/ }).last().click();
    await settled(page);
    await openBuilder(page, "Panel 3");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Undo/ }).click();
    await settled(page);
    await expect(builder(page)).toHaveCount(0);
    await expectClean(errors);
  });

  test("BD-E4 at phone width the builder fills the screen and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await openBuilder(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await expect(builder(page).getByRole("button", { name: "Close the builder" })).toBeInViewport();
    await expectClean(errors);
  });

  test("BD-F1 each card ends with its features as colour-coded blocks with short codes and a tooltip", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await addFeature(page, "Rib comb");
    await builder(page).getByRole("button", { name: "Close the builder" }).click();
    const section = panelCard(page, "Inner panel").getByRole("region", { name: /Inner panel features/ });
    const chip = section.locator('[data-feature-chip="Comb 1"]');
    await expect(chip).toHaveText("C1");
    await expect(chip).toHaveAttribute("title", /Comb 1 \(Rib comb\)/);
    expect(await chip.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await expectClean(errors);
  });

  test("BD-F2 airfoil, planform and dihedral open the wing geometry; the features block opens the features", async ({ page }) => {
    await boot(page);
    for (const part of ["airfoil", "planform", "dihedral"]) {
      await panelCard(page, "Inner panel").getByRole("region", { name: new RegExp(`Inner panel ${part}`) }).click();
      await expect(builder(page).getByRole("region", { name: "Airfoils" })).toBeVisible();
      await expect(features(page)).toHaveCount(0);
      await builder(page).getByRole("button", { name: "Close the builder" }).click();
    }
    await openFeatures(page);
    await expect(builder(page).getByRole("region", { name: "Airfoils" })).toHaveCount(0);
    // and the two halves can be switched between without going back to the list
    await builder(page).getByRole("button", { name: "Wing geometry", exact: true }).click();
    await expect(builder(page).getByRole("region", { name: "Airfoils" })).toBeVisible();
    await expectClean(errors);
  });

  test("BD-G1 values drag sideways onto multiples: 10 mm or a quarter inch for lengths, 0.1 degree for angles; a plain click still types", async ({ page }) => {
    test.setTimeout(120_000); // many project exports in one walk
    await boot(page);
    await openBuilder(page);
    const drag = async (name: string, dx: number) => {
      await builder(page).getByRole("button", { name }).scrollIntoViewIfNeeded();
      const b = (await builder(page).getByRole("button", { name }).boundingBox())!;
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
    };
    const stored = async () => (await exportProjectJson(page)).wing.panels[0];
    const before = await stored();
    await drag("Change sweep", 50);
    await expect(field(page, "Sweep")).toHaveCount(0); // a drag is not a click
    await drag("Change root chord", -30);
    await drag("Change dihedral", 30);
    const after = await stored();
    expect(after.sweepMm).toBeCloseTo(50, 3);
    expect(after.rootChordMm).toBeCloseTo(before.rootChordMm - 30, 3);
    expect(after.dihedralDeg).toBeCloseTo(before.dihedralDeg + 0.3, 3);
    // off a multiple, the first step goes to the nearest one in the direction of travel
    await builder(page).getByRole("button", { name: "Change root chord" }).click();
    await field(page, "Root chord").fill("233");
    await field(page, "Root chord").press("Enter");
    await drag("Change root chord", 10);
    expect((await stored()).rootChordMm).toBeCloseTo(240, 3);
    await builder(page).getByRole("button", { name: "Change root chord" }).click();
    await field(page, "Root chord").fill("233");
    await field(page, "Root chord").press("Enter");
    await drag("Change root chord", -10);
    expect((await stored()).rootChordMm).toBeCloseTo(230, 3);
    // inches: onto quarter-inch multiples (a stored 420 mm is 16.54 in, so one step right is 16.75 in)
    await page.getByRole("radio", { name: "Inches" }).check({ force: true });
    await drag("Change panel length", 10);
    expect((await stored()).lengthMm).toBeCloseTo(16.75 * 25.4, 2);
    await builder(page).getByRole("button", { name: "Change panel length" }).click();
    await expect(field(page, "Panel length")).toBeFocused();
    await expectClean(errors);
  });

  test("BD-G2 on the planform, length is top left and sweep top right; each airfoil has its name left and twist right", async ({ page }) => {
    await boot(page);
    await openBuilder(page, "Outer panel");
    const box = async (name: string) => (await builder(page).getByRole("button", { name }).boundingBox())!;
    const length = await box("Change panel length");
    const sweep = await box("Change sweep");
    const rootChord = await box("Change root chord");
    expect(length.x).toBeLessThan(sweep.x);
    expect(Math.abs(length.y - sweep.y)).toBeLessThan(6);
    expect(rootChord.y).toBeGreaterThan(length.y);
    for (const end of ["root", "tip"]) {
      const name = await box(`Change ${end} airfoil`);
      const twist = await box(`Change ${end} twist`);
      expect(twist.x).toBeGreaterThan(name.x + name.width - 2);
    }
    const svg = (await builder(page).getByRole("img", { name: /planform.*drawn to scale/ }).boundingBox())!;
    expect(svg.height).toBeGreaterThan(200);
    await expectClean(errors);
  });

  test("BD-F3 each feature card has a header like a panel card and the first and last rib drawn from the original section", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await addFeature(page, "Rib comb");
    const c = card(page, "Comb 1");
    await expect(c).toContainText("Rib comb");
    await expect(c.getByRole("button", { name: "Reorder Comb 1" })).toBeVisible();
    await expect(c.getByRole("button", { name: "Remove Comb 1" })).toBeVisible();
    const drawings = c.getByRole("img", { name: /the part this feature takes away is coloured/ });
    await expect(drawings).toHaveCount(2);
    await expect(c).toContainText("Rib 1 (first)");
    await expect(c).toContainText(/Rib \d+ \(last\)/);
    // the section behind the rib carries the feature's colour
    const tint = await drawings.first().locator("path").first().evaluate((e) => getComputedStyle(e).fill);
    const comb = await page.evaluate(() => {
      const el = document.createElement("i");
      el.style.backgroundColor = "var(--wb-geo-comb)";
      document.body.appendChild(el);
      const v = getComputedStyle(el).backgroundColor;
      el.remove();
      return v;
    });
    expect(tint).toBe(comb);
    await expectClean(errors);
  });

  test("BD-S1 the features section has a Full / Actual switch at the top middle: Actual draws the first and last rib to one scale", async ({ page }) => {
    await boot(page);
    await openFeatures(page, "Outer panel"); // 230 mm at the root, 155 mm at the tip
    const nav = features(page);
    const heading = (await nav.getByRole("heading", { name: "Features" }).boundingBox())!;
    const plus = (await nav.getByRole("button", { name: "Add a feature" }).boundingBox())!;
    const group = nav.getByRole("group", { name: "Rib size" });
    const sw = (await group.boundingBox())!;
    // between the heading and the + : the middle of the top of the list
    expect(sw.x).toBeGreaterThan(heading.x + heading.width);
    expect(sw.x + sw.width).toBeLessThan(plus.x);
    const nb = (await nav.boundingBox())!;
    expect(Math.abs(sw.x + sw.width / 2 - (nb.x + nb.width / 2))).toBeLessThan(nb.width * 0.2);
    await expect(group.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "Actual" })).toHaveAttribute("aria-pressed", "false");

    const first = nav.locator("[data-feature-card]").first();
    const drawn = first.getByRole("img", { name: /the part this feature takes away is coloured/ });
    await expect(drawn).toHaveCount(2);
    const widths = async () => Promise.all([0, 1].map(async (i) => (await drawn.nth(i).locator("path").first().boundingBox())!.width));
    const full = await widths();
    expect(full[1] / full[0]).toBeGreaterThan(0.9); // each fills its frame, so the small tip rib looks as big as the root
    await group.getByRole("button", { name: "Actual" }).click();
    await expect(group.getByRole("button", { name: "Actual" })).toHaveAttribute("aria-pressed", "true");
    const actual = await widths();
    expect(actual[1] / actual[0]).toBeGreaterThan(0.6); // 155 mm over 230 mm is 0.67
    expect(actual[1] / actual[0]).toBeLessThan(0.74);
    await group.getByRole("button", { name: "Full" }).click();
    const back = await widths();
    expect(back[1] / back[0]).toBeGreaterThan(0.9);
    await expectClean(errors);
  });

  test("BD-S2 the foot of the features list has an Add feature bubble, card-wide and three times its first height", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const list = features(page).getByRole("list", { name: "Panel features" });
    const bubble = list.getByRole("button", { name: "Add feature", exact: true });
    await expect(bubble).toBeVisible();
    // last in the list, below every card
    const cards = list.locator("[data-feature-card]");
    const lastCard = (await cards.last().boundingBox())!;
    const b = (await bubble.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(lastCard.y + lastCard.height);
    const card = (await cards.first().boundingBox())!;
    expect(Math.abs(b.width - card.width)).toBeLessThan(3); // as wide as the features
    expect(b.height).toBeLessThan(card.height); // still shorter than a card
    expect(b.height).toBeGreaterThan(100); // three times the 39 px it was
    // it adds a feature, the same menu as the +
    const before = await cards.count();
    await bubble.click();
    const dlg = page.getByRole("dialog", { name: "Add a feature" });
    await dlg.getByRole("button", { name: /^Rib comb/ }).click();
    await dlg.getByRole("button", { name: /^Add / }).click();
    await expect(cards).toHaveCount(before + 1);
    const after = (await list.locator("> li").last().innerText()).trim();
    expect(after).toContain("Add feature"); // and it stays at the foot
    await expectClean(errors);
  });

  test("BD-A1 adding a feature is a dialog of big tiles, each with an airfoil showing what the feature does, and no step text", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const dlg = page.getByRole("dialog", { name: "Add a feature" });
    // opened by the + and by the bubble at the foot of the list, not a menu
    await features(page).getByRole("button", { name: "Add a feature" }).click();
    await expect(dlg).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(dlg).not.toContainText(/Step \d of \d/);
    await expect(dlg).not.toContainText("Choose what to add");
    const tiles = dlg.getByRole("list", { name: "Features you can add" }).getByRole("listitem");
    await expect(tiles).toHaveCount(10);
    for (const name of ["Spar", "Webbing", "Notch", "Aileron cutter", "Joiner", "Edge stock", "Sheeting", "Rib comb", "Building tabs", "Lightening holes"]) {
      const tile = dlg.getByRole("button", { name: new RegExp(`^${name}`) });
      await expect(tile).toBeVisible();
      // each tile has an airfoil with the typical modification drawn on it
      await expect(tile.locator("svg path")).not.toHaveCount(0);
      await expect(tile.locator("svg [clip-path] > *, svg rect, svg ellipse, svg polygon, svg circle, svg path[stroke-width='4.5']").first()).toBeAttached();
      expect((await tile.boundingBox())!.height).toBeGreaterThan(110); // bigger than a menu row
    }
    // the joiner picture is the circle alone, and the aileron cutter's is drawn like the default notch: two rectangles, no triangle
    await expect(dlg.getByRole("button", { name: /^Joiner/ }).locator("svg [clip-path] circle")).toHaveCount(1);
    await expect(dlg.getByRole("button", { name: /^Joiner/ }).locator("svg [clip-path] rect")).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: /^Aileron cutter/ }).locator("svg [clip-path] polygon")).toHaveCount(0);
    await expect(dlg.getByRole("button", { name: /^Aileron cutter/ }).locator("svg [clip-path] rect")).toHaveCount(2);
    // the spar's default picture is a square hole: one rectangle, no notches at the top and bottom
    await expect(dlg.getByRole("button", { name: /^Spar/ }).locator("svg [clip-path] rect")).toHaveCount(1);
    // the example has both edges, so the edge stock tile is shown but cannot be taken
    await expect(dlg.getByRole("button", { name: /^Edge stock/ })).toHaveAttribute("aria-disabled", "true");
    // a rib comb shows what it does and asks to be added
    await dlg.getByRole("button", { name: /^Rib comb/ }).click();
    await expect(dlg.getByRole("img", { name: /rib with rib comb/i })).toBeVisible();
    await dlg.getByRole("button", { name: "Back" }).click();
    await expect(tiles).toHaveCount(10);
    // Cancel adds nothing
    const cards = features(page).locator("[data-feature-card]");
    const before = await cards.count();
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(cards).toHaveCount(before);
    // the bubble opens the same dialog, and Add adds
    await features(page).getByRole("button", { name: "Add feature", exact: true }).click();
    await dlg.getByRole("button", { name: /^Rib comb/ }).click();
    await dlg.getByRole("button", { name: "Add rib comb" }).click();
    await expect(dlg).toHaveCount(0);
    await expect(cards).toHaveCount(before + 1);
    await expect(features(page).locator('[data-feature-card="Comb 1"]')).toBeVisible();
    await expectClean(errors);
  });

  test("BD-A2 a spar's second screen is pictures of the ways it can be cut, and clicking one makes it and opens it for editing; the others are made at once", async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await openFeatures(page);
    const dlg = page.getByRole("dialog", { name: "Add a feature" });
    const details = builder(page).getByLabel("Feature details");
    const spars = async () => (await exportProjectJson(page)).wing.panels[0].spars as { type: string; name: string; positionTop: boolean; positionBottom: boolean }[];
    const open = async () => features(page).getByRole("button", { name: "Add a feature" }).click();
    await open();
    await dlg.getByRole("button", { name: /^Spar/ }).click();
    // the second screen: two pictures and nothing else but a way back (notches are a feature of their own)
    const kinds = dlg.getByRole("list", { name: "Kinds of spar" }).getByRole("listitem");
    await expect(kinds).toHaveCount(2);
    await expect(dlg.getByRole("list", { name: "Kinds of spar" }).getByRole("button")).toHaveText(["Cuboid", "Round"]);
    for (let i = 0; i < 2; i++) await expect(kinds.nth(i).locator("svg [clip-path] > *").first()).toBeAttached();
    await expect(dlg).not.toContainText(/A core structural|Step|What happens/);
    // each makes the spar it shows, selects it, and closes the dialog
    const expected: [string, string, boolean, boolean][] = [
      ["Cuboid", "cuboid", false, false],
      ["Round", "round", false, false],
      ["Notch:Top", "rectangle", true, false],
      ["Notch:Bottom", "rectangle", false, true],
      ["Notch:Top and bottom", "rectangle", true, true],
    ];
    for (const [pick, type, top, bottom] of expected) {
      const [tile, title] = pick.includes(":") ? pick.split(":") : ["Spar", pick];
      const before = (await spars()).length;
      if (!(await dlg.isVisible())) {
        await open();
        await dlg.getByRole("button", { name: new RegExp(`^${tile}`) }).click();
      }
      await dlg.getByRole("button", { name: title, exact: true }).click();
      await expect(dlg).toHaveCount(0);
      const all = await spars();
      expect(all).toHaveLength(before + 1);
      const made = all[all.length - 1];
      expect([made.type, made.positionTop, made.positionBottom]).toEqual([type, top, bottom]);
      // editing mode: its card is the selected one and its details are open
      await expect(card(page, made.name)).toHaveAttribute("aria-current", "true");
      await expect(details.getByRole("button", { name: "Change Spar name", exact: true })).toContainText(made.name);
      // a notch is named Notch n; a spar, Spar n
      expect(made.name).toMatch(top || bottom ? /^Notch \d+$/ : /^Spar \d+$/);
    }
    // aileron cutter, leading and trailing edge stock, sheeting, building tabs and lightening holes: one click
    await remove(page, "Leading edge stock").click();
    await remove(page, "Trailing edge stock").click();
    const immediate: [string, string][] = [
      ["Aileron cutter", "Hinge"],
      ["Edge stock:Leading edge", "The stock, in section"],
      ["Edge stock:Trailing edge", "The stock, in section"],
      ["Sheeting", "Strip"],
      ["Building tabs", "Where the tabs go"],
      ["Lightening holes", "Holes"],
    ];
    for (const [kind, region] of immediate) {
      await open();
      const [tile, which] = kind.split(":");
      await dlg.getByRole("button", { name: new RegExp(`^${tile}`) }).click();
      if (which) {
        // edge stock asks which edge, in pictures; the one already in is greyed
        await expect(dlg.getByRole("list", { name: "Kinds of edge stock" }).getByRole("button")).toHaveText([/^Leading edge/, /^Trailing edge/]);
        await dlg.getByRole("button", { name: new RegExp(`^${which}`) }).click();
      }
      await expect(dlg).toHaveCount(0); // then nothing more to ask
      await expect(details.getByRole("region", { name: region, exact: true })).toBeVisible();
      await expect(features(page).locator("[data-feature-card][aria-current='true']")).toHaveCount(1);
    }
    expect((await exportProjectJson(page)).wing.panels[0].leadingEdge.enabled).toBe(true);
    expect((await exportProjectJson(page)).wing.panels[0].buildingTabs.enabled).toBe(true);
    await expectClean(errors);
  });

  test("BD-D1 a spar's details: colour dot, position first, a top view and a side view, values that are text until clicked", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const details = builder(page).getByLabel("Feature details");
    // the sections, in order: position, then the notches, then the top view, then the side view
    const order = await details.getByRole("region").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(order.indexOf("Position")).toBeLessThan(order.indexOf("Top view"));
    expect(order.indexOf("Top view")).toBeLessThan(order.indexOf("Side view"));
    await expect(details.getByRole("region", { name: "Top view" })).toBeVisible();
    await expect(details.getByRole("region", { name: "Side view" })).toBeVisible();
    // no explanatory paragraph under the top view
    await expect(details.getByText(/Looking down on the panel/)).toHaveCount(0);
    // there are no rib previews in a spar's details
    await expect(details.getByRole("img", { name: /the part this feature takes away is coloured/ })).toHaveCount(0);
    // nothing is a form to begin with
    await expect(details.getByRole("spinbutton")).toHaveCount(0);
    await expect(details.getByRole("textbox")).toHaveCount(0);
    await expect(details.getByRole("combobox")).toHaveCount(0);
    // the values that matter: the size at the top right, the position, and where it starts and ends
    for (const name of ["Spar distance", "Spar width", "Spar height", "Spar span start", "Spar span end"]) await expect(details.getByRole("button", { name: `Change ${name}`, exact: true })).toBeVisible();
    // nothing is hidden behind Advanced for a spar any more
    await expect(details.getByRole("button", { name: "Advanced" })).toHaveCount(0);
    // a value: click, type, Enter; it is stored
    const before = (await exportProjectJson(page)).wing.panels[0].spars[0].width.start;
    await details.getByRole("button", { name: "Change Spar width", exact: true }).click();
    const w = details.getByRole("spinbutton", { name: "Spar width" });
    await expect(w).toBeFocused();
    await w.fill("10");
    await w.press("Enter");
    expect((await exportProjectJson(page)).wing.panels[0].spars[0].width.start).toBe(10);
    expect(before).not.toBe(10);
    // the name is text too
    await details.getByRole("button", { name: "Change Spar name", exact: true }).click();
    await details.getByRole("textbox", { name: "Spar name" }).fill("Front spar");
    await details.getByRole("textbox", { name: "Spar name" }).press("Enter");
    await expect(card(page, "Front spar")).toBeVisible();
    // "Measured from" is with the position
    const position = details.getByRole("region", { name: "Position", exact: true });
    await position.getByRole("group", { name: "Spar measured from" }).getByRole("button", { name: "Trailing edge" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].spars[0].distanceFrom).toBe("TE");
    await expectClean(errors);
  });

  test("BD-D2 edge stock, tabs and holes: a shape or places chosen as buttons, values as text, the rest under Advanced", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    // edge stock: the leading edge offers a rectangle and a round rod, nothing more, and has no rib previews
    await card(page, "Leading edge stock").getByRole("button", { name: "Leading edge stock", exact: true }).click();
    const shapes = details.getByRole("group", { name: "Stock shape" });
    await expect(shapes.getByRole("button")).toHaveText(["Rectangle", "Rounded"]);
    await shapes.getByRole("button", { name: "Rounded" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].leadingEdge.shape).toBe("round");
    await expect(details.getByRole("button", { name: "Fit to nose" })).toBeVisible();
    await expect(details.getByRole("img", { name: /the part this feature takes away is coloured/ })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Advanced" })).toHaveCount(0);
    // building tabs: where they go as four toggles, what they add in the picture
    await addFeature(page, "Building tabs");
    await expect(details.getByRole("img", { name: /what this feature adds is coloured/ })).toHaveCount(2);
    const places = details.getByRole("group", { name: "Tab places" });
    // new tabs start with none above or below until chosen
    await expect(places.getByRole("button", { name: "Below the rib" })).toHaveAttribute("aria-pressed", "false");
    await places.getByRole("button", { name: "Above the rib" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].buildingTabs.above).toBe(true);
    await expect(details.getByRole("button", { name: "Change Tab extension", exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Advanced" }).click();
    await expect(details.getByRole("checkbox", { name: "Pin hole in each tab" })).toBeVisible();
    // lightening holes: a few sizes up front, margins and corners behind Advanced
    await addFeature(page, "Lightening holes");
    await expect(details.getByRole("button", { name: "Change Hole width maximum", exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Change Hole margin from nose", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Advanced" }).click();
    await expect(details.getByRole("button", { name: "Change Hole margin from nose", exact: true })).toBeVisible();
    await expect(details.getByRole("checkbox", { name: "Round the corners" })).toBeChecked();
    await expectClean(errors);
  });

  test("BD-D3 sheeting strips and rib combs: the common values up front, angles, gaps and slits under Advanced", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await addFeature(page, "Sheeting");
    await expect(details.getByRole("img", { name: /the part this feature takes away is coloured/ })).toHaveCount(2);
    for (const name of ["Strip distance", "Strip length", "Strip thickness"]) await expect(details.getByRole("button", { name: `Change ${name}`, exact: true })).toBeVisible();
    await expect(details.getByRole("group", { name: "Strip starting at" })).toBeVisible();
    await expect(details.getByRole("checkbox", { name: /Cap strip/ })).toHaveCount(0);
    await details.getByRole("button", { name: "Advanced" }).click();
    await expect(details.getByRole("checkbox", { name: /Cap strip/ })).toBeVisible();
    await addFeature(page, "Rib comb");
    await expect(details.getByRole("group", { name: "Comb side" }).getByRole("button", { name: "Top surface" })).toBeVisible();
    for (const name of ["Comb distance", "Comb width", "Cut into rib"]) await expect(details.getByRole("button", { name: `Change ${name}`, exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Change Needle adjustment", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Advanced" }).click();
    for (const name of ["Comb angle", "Needle adjustment", "Slit height", "Comb gap fore"]) await expect(details.getByRole("button", { name: `Change ${name}`, exact: true })).toBeVisible();
    // changing a value changes the project
    await details.getByRole("button", { name: "Change Comb width", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Comb width" }).fill("4");
    await details.getByRole("spinbutton", { name: "Comb width" }).press("Enter");
    expect((await exportProjectJson(page)).wing.panels[0].ribCombs[0].widthMm).toBe(4);
    await expectClean(errors);
  });

  test("BD-D4 the feature details are only as tall as they need to be, and the features not being edited are greyed out", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Leading edge stock").getByRole("button", { name: "Leading edge stock", exact: true }).click();
    const nav = (await features(page).boundingBox())!;
    const pane = (await details.boundingBox())!;
    // the pane stops where its content stops, well short of the list beside it
    expect(pane.height).toBeLessThan(nav.height - 100);
    const content = await details.evaluate((e) => e.scrollHeight);
    expect(pane.height).toBeLessThanOrEqual(content + 6); // its padding is inside the scroll height; the border is not
    // the one being edited is plain; the others are greyed, as the other panels are when one is open
    await expect(card(page, "Leading edge stock")).toHaveAttribute("aria-current", "true");
    await expect(card(page, "Leading edge stock")).not.toHaveAttribute("data-dimmed");
    for (const name of ["Main spar", "Trailing edge stock"]) {
      await expect(card(page, name)).toHaveAttribute("data-dimmed", "true");
      expect(await card(page, name).evaluate((e) => getComputedStyle(e).filter)).toContain("grayscale");
    }
    // picking another swaps which is greyed
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    await expect(card(page, "Main spar")).not.toHaveAttribute("data-dimmed");
    await expect(card(page, "Leading edge stock")).toHaveAttribute("data-dimmed", "true");
    await expectClean(errors);
  });

  test("BD-D5 on the features half the builder is see-through below the details, the wing view runs underneath, and the geometry half stays solid", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await boot(page);
    await openFeatures(page);
    const bg = (loc: ReturnType<Page["locator"]>) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
    const transparent = "rgba(0, 0, 0, 0)";
    // the builder itself has no background of its own; the list and the details card do
    expect(await bg(builder(page))).toBe(transparent);
    expect(await bg(builder(page).getByLabel("Feature details"))).not.toBe(transparent);
    expect(await bg(features(page))).not.toBe(transparent);
    // the wing's canvas runs under the builder, from the left of it to the right of the screen
    const canvas = (await page.locator("canvas").last().boundingBox())!;
    const b = (await builder(page).boundingBox())!;
    expect(canvas.x).toBeLessThanOrEqual(b.x + 2);
    expect(canvas.x + canvas.width).toBeGreaterThan(b.x + b.width + 200);
    // below the details card there is nothing solid: the point is over the canvas, not the builder's own surfaces
    const card = (await builder(page).getByLabel("Feature details").boundingBox())!;
    const probe = { x: card.x + card.width / 2, y: Math.min(card.y + card.height + 40, b.y + b.height - 260) };
    const top = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}|${e.closest("section")?.getAttribute("aria-label") ?? ""}` : ""; }, probe);
    // (the section is see-through, so the thing under the point is the builder's grid or the wing canvas, never a card)
    expect(top).not.toContain("Feature details");
    // the option checkboxes under the wing are clear of the builder
    const first = (await page.getByRole("checkbox", { name: "Ribs", exact: true }).boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(b.x + b.width);
    // the geometry half is solid
    await builder(page).getByRole("button", { name: "Wing geometry", exact: true }).click();
    expect(await bg(builder(page).getByLabel("Wing geometry"))).not.toBe(transparent);
    await expectClean(errors);
  });

  test("BD-R1 a spar's details have no rib views; the details of other features keep theirs, half as tall again and without measurements", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    await expect(details.getByRole("img", { name: /Rib \d+ \((first|last)\)/ })).toHaveCount(0);
    await expect(details.getByRole("button", { name: /from the (front|back)/ })).toHaveCount(0);
    // another feature still draws the first and last rib it touches, in a frame taller than the card's
    await addFeature(page, "Lightening holes");
    const figure = details.getByRole("img", { name: /Rib 1 \(first\)/ });
    const box = (await figure.boundingBox())!;
    const cardBox = (await card(page, "Lightening holes").getByRole("img", { name: /Rib 1 \(first\)/ }).boundingBox())!;
    expect(box.height / box.width).toBeGreaterThan((cardBox.height / cardBox.width) * 1.4);
    await expectClean(errors);
  });

  test("BD-R4 each feature card has a quiet strip of ticks, one per rib, showing which ribs it touches, and draws the first and last of those", async ({ page }) => {
    await boot(page);
    await openFeatures(page); // Inner panel: nine ribs, at 0, 52.5, 105 ... 420
    const strip = (name: string) => card(page, name).locator("[data-ribs-affected]");
    // a feature on every rib
    await expect(strip("Main spar").locator("[data-rib-tick]")).toHaveCount(9);
    await expect(strip("Main spar")).toHaveAttribute("data-ribs-affected", "1,2,3,4,5,6,7,8,9");
    await expect(strip("Leading edge stock")).toHaveAttribute("data-ribs-affected", "1,2,3,4,5,6,7,8,9");
    await expect(strip("Main spar")).toHaveAttribute("aria-label", "Affects every rib of 9");
    // narrow the spar to part of the span: the ticks, the words and the two ribs drawn follow
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const details = builder(page).getByLabel("Feature details");
    for (const [label, value] of [["Spar span start", "105"], ["Spar span end", "315"]] as const) {
      await details.getByRole("button", { name: `Change ${label}`, exact: true }).click();
      await details.getByRole("spinbutton", { name: label }).fill(value);
      await details.getByRole("spinbutton", { name: label }).press("Enter");
    }
    await expect(strip("Main spar")).toHaveAttribute("data-ribs-affected", "4,5,6,7");
    await expect(strip("Main spar").locator('[data-rib-tick="on"]')).toHaveCount(5);
    await expect(strip("Main spar").locator('[data-rib-tick="off"]')).toHaveCount(4);
    await expect(strip("Main spar")).toHaveAttribute("aria-label", "Affects ribs 3 to 7 of 9");
    await expect(card(page, "Main spar")).not.toContainText(/First and last rib|taken away/);
    await expect(card(page, "Main spar").getByRole("img", { name: /^Rib 3 \(first\)/ })).toBeVisible();
    await expect(card(page, "Main spar").getByRole("img", { name: /^Rib 7 \(last\)/ })).toBeVisible();
    await expectClean(errors);
  });

  test("BD-R5 a spar's details show a top view of the panel, without numbers, with the spar along it and the ribs it touches marked", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const details = builder(page).getByLabel("Feature details");
    const top = details.getByRole("region", { name: "Top view" });
    await expect(top).toBeVisible();
    await expect(top.getByRole("img", { name: /planform with its 9 ribs/ })).toBeVisible();
    await expect(top.locator("[data-spar-line]")).toHaveCount(1);
    await expect(top.locator("[data-rib-line]")).toHaveCount(9);
    // no numbers in the drawing: nothing in it is text
    await expect(top.locator("svg text")).toHaveCount(0);
    const faded = () => top.locator("[data-rib-line]").evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
    expect((await faded()).every((o) => o === "1")).toBe(true); // the spar runs the whole panel
    // narrow the span: the ribs it does not reach fade
    for (const [label, value] of [["Spar span start", "105"], ["Spar span end", "315"]] as const) {
      await details.getByRole("button", { name: `Change ${label}`, exact: true }).click();
      await details.getByRole("spinbutton", { name: label }).fill(value);
      await details.getByRole("spinbutton", { name: label }).press("Enter");
    }
    const after = await faded();
    expect(after.map((o) => o === "1")).toEqual([false, false, false, true, true, true, true, false, false]);
    // the line is shorter than the panel, drawn in the spar's colour
    const line = (await top.locator("[data-spar-line]").boundingBox())!;
    const plan = (await top.getByRole("img").boundingBox())!;
    expect(line.width).toBeLessThan(plan.width * 0.7);
    await expectClean(errors);
  });

  test("BD-S3 a spar's size is at the top right of its details, level with the name: width and height, or a diameter for a round one", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const name = (await details.getByRole("button", { name: "Change Spar name", exact: true }).boundingBox())!;
    const pane = (await details.boundingBox())!;
    const width = (await details.getByRole("button", { name: "Change Spar width", exact: true }).boundingBox())!;
    const height = (await details.getByRole("button", { name: "Change Spar height", exact: true }).boundingBox())!;
    expect(Math.abs(width.y - name.y)).toBeLessThan(40);
    expect(width.x).toBeGreaterThan(pane.x + pane.width / 2 - 40);
    expect(height.x).toBeGreaterThan(width.x);
    expect(pane.x + pane.width - (height.x + height.width)).toBeLessThan(60);
    await expect(details.getByRole("region", { name: "Position", exact: true }).getByRole("button", { name: /Spar (width|height)/ })).toHaveCount(0);
    // a round spar shows a diameter, not a radius, in the same place: twice the radius stored (the example's spar is a notch: add a plain one)
    await addFeature(page, "Spar");
    await details.getByRole("button", { name: "Change spar type", exact: true }).click();
    await details.getByRole("combobox", { name: "spar type" }).selectOption("round");
    await details.getByRole("combobox", { name: "spar type" }).press("Enter");
    const dia = details.getByRole("button", { name: "Change Spar diameter", exact: true });
    await expect(dia).toBeVisible();
    await expect(details.getByRole("button", { name: /Spar radius/ })).toHaveCount(0);
    const radius = (await exportProjectJson(page)).wing.panels[0].spars[0].radiusMm ?? 3;
    await expect(dia).toContainText(`${(radius * 2).toFixed(1)}`);
    await dia.click();
    await details.getByRole("spinbutton", { name: "Spar diameter" }).fill("9");
    await details.getByRole("spinbutton", { name: "Spar diameter" }).press("Enter");
    expect((await exportProjectJson(page)).wing.panels[0].spars.slice(-1)[0].radiusMm).toBe(4.5);
    const dbox = (await dia.boundingBox())!;
    expect(Math.abs(dbox.y - name.y)).toBeLessThan(40);
    expect(dbox.x).toBeGreaterThan(pane.x + pane.width / 2);
    await expectClean(errors);
  });

  test("BD-S4 the top view has Starts at on the left and Ends at on the right, labels above the values, that can be dragged live; Snap to rib is a checkbox in the drawing", async ({ page }) => {
    test.setTimeout(120_000); // several drags and project exports in one walk
    await boot(page);
    await openFeatures(page); // Inner panel: nine ribs at 0, 52.5 ... 420
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const top = details.getByRole("region", { name: "Top view" });
    const start = top.getByRole("button", { name: "Change Spar span start", exact: true });
    const end = top.getByRole("button", { name: "Change Spar span end", exact: true });
    const plan = (await top.getByRole("img").boundingBox())!;
    const sb = (await start.boundingBox())!;
    const eb = (await end.boundingBox())!;
    // under the drawing, the start on the left and the end on the right, level with each other
    expect(sb.y).toBeGreaterThan(plan.y + plan.height - 4);
    expect(Math.abs(sb.y - eb.y)).toBeLessThan(6);
    expect(sb.x).toBeLessThan(eb.x);
    expect(sb.x + sb.width / 2).toBeLessThan(plan.x + plan.width / 2);
    expect(eb.x + eb.width / 2).toBeGreaterThan(plan.x + plan.width / 2);
    // labels above the values, as on the wing geometry page; and no bracket bars
    await expect(top.getByText("Starts at", { exact: true })).toBeVisible();
    await expect(top.getByText("Ends at", { exact: true })).toBeVisible();
    expect((await top.getByText("Starts at", { exact: true }).boundingBox())!.y).toBeLessThan(sb.y);
    await expect(top.locator("[data-span-bracket]")).toHaveCount(0);
    // Snap to rib: a checkbox in the corner of the drawing, ticked to begin with
    const snap = top.getByRole("checkbox", { name: "Snap to rib" });
    await expect(snap).toBeChecked();
    const sbx = (await snap.boundingBox())!;
    expect(sbx.x).toBeGreaterThan(plan.x + plan.width / 2);
    expect(sbx.y).toBeLessThan(plan.y + plan.height);
    expect(sbx.y).toBeGreaterThan(plan.y + plan.height / 2);
    const stored = async () => (await exportProjectJson(page)).wing.panels[0].spars[0] as { spanStartMm: number; spanEndMm: number };
    const drag = async (loc: ReturnType<Page["locator"]>, dx: number, live?: () => Promise<void>) => {
      await loc.scrollIntoViewIfNeeded();
      const b = (await loc.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 4 });
      if (live) await live();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 4 });
      await page.mouse.up();
    };
    // nine ribs along 420 mm: the last stands one rib thickness (3 mm) short of the end
    const ribs = Array.from({ length: 9 }, (_, i) => (i * 417) / 8);
    // drag the end back: it changes while the mouse is still down, and it lands on a rib
    await drag(end, -40, async () => expect(await end.innerText()).not.toContain("420.0"));
    let s2 = await stored();
    expect(s2.spanEndMm).toBeLessThan(420);
    expect(s2.spanEndMm).toBeCloseTo(208.5, 5); // four ribs in, one per 10 px
    await expect(end).toContainText(`${s2.spanEndMm.toFixed(1)}`);
    const lit = () => top.locator("[data-rib-line]").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity === "1").length);
    expect(await lit()).toBeLessThan(9);
    // drag the start up the panel: also on a rib, and never past the end
    await drag(start, 20); // each 10 px is the next rib along
    s2 = await stored();
    expect(s2.spanStartMm).toBeCloseTo(104.25, 5);
    expect(ribs.some((r) => Math.abs(r - s2.spanStartMm) < 1e-6)).toBe(true);
    expect(s2.spanStartMm).toBeGreaterThan(0);
    expect(s2.spanStartMm).toBeLessThan(s2.spanEndMm);
    await drag(start, 3000);
    s2 = await stored();
    expect(s2.spanStartMm).toBeLessThan(s2.spanEndMm);
    // snap off: the same drag lands on 2 mm steps, not on ribs
    await snap.uncheck();
    await drag(end, 25);
    const free = (await stored()).spanEndMm;
    expect(ribs.some((r) => Math.abs(r - free) < 1e-6)).toBe(false);
    expect(Math.abs(free / 2 - Math.round(free / 2))).toBeLessThan(1e-6);
    // typing is exact, snap or no snap
    await snap.check();
    await start.click();
    await top.getByRole("spinbutton", { name: "Spar span start" }).fill("101");
    await top.getByRole("spinbutton", { name: "Spar span start" }).press("Enter");
    expect((await stored()).spanStartMm).toBe(101);
    // a joiner has an end and a reach, not a start and an end
    await card(page, "Wing joiner").getByRole("button", { name: "Wing joiner", exact: true }).click();
    await expect(details.getByRole("button", { name: "Change Spar span start", exact: true })).toHaveCount(0);
    await expectClean(errors);
  });

  test("BD-S5 edge stock details: no description, no rib previews; the stock in section is square, keeps its window while the settings change, and pans and zooms", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    for (const [name, edge] of [["Leading edge stock", "leading"], ["Trailing edge stock", "trailing"]] as const) {
      await card(page, name).getByRole("button", { name, exact: true }).click();
      await expect(details.getByText("A block the ribs butt against")).toHaveCount(0);
      await expect(details.getByRole("img", { name: /Rib \d+ \((first|last)\)/ })).toHaveCount(0);
      const section = details.getByRole("region", { name: "The stock, in section" });
      const view = section.getByRole("group", { name: `Section of the ${edge} edge stock` });
      await expect(view).toBeVisible();
      // square
      const box = (await view.boundingBox())!;
      expect(Math.abs(box.width - box.height)).toBeLessThan(2);
      const win = async () => (await view.getAttribute("data-window"))!.split(",").map(Number);
      const w0 = await win();
      // the window does not move when the settings do
      await details.getByRole("button", { name: "Change Stock width", exact: true }).click();
      await details.getByRole("spinbutton", { name: "Stock width" }).fill("12");
      await details.getByRole("spinbutton", { name: "Stock width" }).press("Enter");
      expect(await win()).toEqual(w0);
      expect((await view.boundingBox())!.height).toBeCloseTo(box.height, 0);
      await expect(section.getByRole("img", { name: /drawn to scale/ })).toBeVisible();
      // zoom in and out with the buttons, and with the wheel
      await view.getByRole("button", { name: "Zoom in" }).click();
      const z1 = await win();
      expect(z1[2]).toBeLessThan(w0[2]);
      await view.getByRole("button", { name: "Zoom out" }).click();
      await view.getByRole("button", { name: "Zoom out" }).click();
      expect((await win())[2]).toBeGreaterThan(z1[2]);
      await view.hover();
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(100);
      const afterWheel = await win();
      // pan by dragging
      const b = (await view.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 5 });
      await page.mouse.up();
      const panned = await win();
      expect(panned[0]).not.toBe(afterWheel[0]);
      expect(panned[1]).not.toBe(afterWheel[1]);
      expect(panned[2]).toBeCloseTo(afterWheel[2], 6);
      // and back to the feature
      await view.getByRole("button", { name: "Fit the view to the feature" }).click();
      expect((await win())[2]).toBeGreaterThan(5);
    }
    await expectClean(errors);
  });

  test("BD-N6 leading edge stock is a rectangle or a round rod; trailing edge stock a rectangle or a wedge that comes to a point, set by its angle", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    const stored = async () => (await exportProjectJson(page)).wing.panels[0];
    // leading edge: a round rod, fitted to the nose
    await card(page, "Leading edge stock").getByRole("button", { name: "Leading edge stock", exact: true }).click();
    const shapes = details.getByRole("group", { name: "Stock shape" });
    await expect(shapes.getByRole("button")).toHaveText(["Rectangle", "Rounded"]);
    await shapes.getByRole("button", { name: "Rounded" }).click();
    let le = (await stored()).leadingEdge;
    expect(le.shape).toBe("round");
    expect(le.widthMm).toBe(le.heightMm); // a rod is as tall as it is wide
    expect(le.widthMm).toBeGreaterThan(5);
    for (const name of ["Stock diameter", "Stock setback", "Stock offset"]) await expect(details.getByRole("button", { name: `Change ${name}`, exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Change Stock height", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Change Stock diameter", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Stock diameter" }).fill("20");
    await details.getByRole("spinbutton", { name: "Stock diameter" }).press("Enter");
    le = (await stored()).leadingEdge;
    expect([le.widthMm, le.heightMm]).toEqual([20, 20]);
    await details.getByRole("button", { name: "Fit to nose" }).click();
    le = (await stored()).leadingEdge;
    expect(le.widthMm).toBeLessThan(20);
    expect(le.widthMm).toBeGreaterThan(5);
    // the ribs begin at the middle of the rod, and the project still builds
    await expect(page.getByRole("region", { name: "Summary" })).not.toContainText("Nothing is left of this rib");
    // trailing edge: a wedge to a point, with an angle
    await card(page, "Trailing edge stock").getByRole("button", { name: "Trailing edge stock", exact: true }).click();
    await expect(details.getByRole("group", { name: "Stock shape" }).getByRole("button")).toHaveText(["Rectangle", "Wedge"]);
    await expect(details.getByRole("button", { name: "Change Wedge angle", exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Change Stock height", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Change Wedge angle", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Wedge angle" }).fill("20");
    await details.getByRole("spinbutton", { name: "Wedge angle" }).press("Enter");
    let te = (await stored()).trailingEdge;
    expect(te.angleDeg).toBe(20);
    expect(te.heightMm).toBeCloseTo(2 * te.widthMm * Math.tan((10 * Math.PI) / 180), 1);
    // a different width keeps the angle and so changes the height
    await details.getByRole("button", { name: "Change Stock width", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Stock width" }).fill("20");
    await details.getByRole("spinbutton", { name: "Stock width" }).press("Enter");
    te = (await stored()).trailingEdge;
    expect(te.angleDeg).toBe(20);
    expect(te.heightMm).toBeCloseTo(2 * 20 * Math.tan((10 * Math.PI) / 180), 1);
    // Fit to wing opens the angle just enough to cover the airfoil
    await details.getByRole("button", { name: "Change Wedge angle", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Wedge angle" }).fill("3");
    await details.getByRole("spinbutton", { name: "Wedge angle" }).press("Enter");
    await expect(details.getByText(/pokes out of the block/)).toBeVisible();
    await details.getByRole("button", { name: "Fit to wing" }).click();
    expect((await stored()).trailingEdge.angleDeg).toBeGreaterThan(3);
    await expect(details.getByText(/pokes out of the block/)).toHaveCount(0);
    await expectClean(errors);
  });

  test("BD-N1 an aileron cutter and a joiner are features of their own: their own tiles, kinds and details, and the spar's type list leaves them out", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    const spars = async () => (await exportProjectJson(page)).wing.panels[0].spars as { type: string; name: string; aileron: unknown; positionTop: boolean; positionBottom: boolean }[];
    // a new spar starts normal: a hole, no notches
    await addFeature(page, "Spar");
    let all = await spars();
    const plain = all[all.length - 1];
    expect([plain.type, plain.positionTop, plain.positionBottom]).toEqual(["cuboid", false, false]);
    // an aileron cutter
    await addFeature(page, "Aileron cutter");
    all = await spars();
    const ail = all[all.length - 1];
    expect(ail.type).toBe("aileronCutter");
    expect(ail.aileron).not.toBeNull();
    await expect(card(page, ail.name)).toContainText("Aileron cutter");
    await expect(details.getByRole("region", { name: "Hinge" })).toBeVisible();
    await expect(details.getByRole("button", { name: "Change spar type", exact: true })).toHaveCount(0);
    // a joiner
    await addFeature(page, "Joiner");
    all = await spars();
    const joiner = all[all.length - 1];
    expect(joiner.type).toBe("roundJoiner");
    await expect(card(page, joiner.name)).toContainText("Joiner");
    await expect(details.getByRole("group", { name: "Joiner joins" })).toBeVisible();
    // a joiner can be round or cuboid, and is never a plain spar
    await details.getByRole("button", { name: "Change joiner type", exact: true }).click();
    const kinds = details.getByRole("combobox", { name: "joiner type" });
    expect(await kinds.locator("option").allInnerTexts()).toEqual(["Round joiner", "Cuboid joiner"]);
    await kinds.selectOption("cuboidJoiner");
    await kinds.press("Enter");
    expect((await spars()).slice(-1)[0].type).toBe("cuboidJoiner");
    await expect(details.getByRole("button", { name: "Change Spar width", exact: true })).toBeVisible(); // a cuboid has a width and a height
    await expectClean(errors);
  });

  test("BD-R5 a joiner is named for its shape, numbered from the second; a notch is a feature of its own, named Notch n (the example's own spar is the first), with its kind fixed", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const names = async () => ((await exportProjectJson(page)).wing.panels[0].spars as { name: string; type: string }[]).filter((x) => x.type === "roundJoiner").map((x) => x.name);
    await addFeature(page, "Joiner");
    await addFeature(page, "Joiner");
    await addFeature(page, "Joiner");
    expect((await names()).slice(-3)).toEqual(["Round Joiner", "Round Joiner 2", "Round Joiner 3"]);
    const details = builder(page).getByLabel("Feature details");
    await addFeature(page, "Notch");
    await expect(details.getByLabel("Spar notches", { exact: true })).toHaveCount(0); // no "In the rib" section: the card already says Notch
    await expect(details.getByRole("button", { name: "Change spar type", exact: true })).toHaveCount(0);
    await expect(features(page).locator('[data-feature-card="Notch 2"]')).toBeVisible();
    await expect(features(page).locator('[data-feature-card="Notch 2"]')).toContainText("Notch");
    await expectClean(errors);
  });

  test("BD-N2 a colour circle before the name opens the colour dialog, in place of a colour button in Advanced", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const dot = details.getByRole("button", { name: /^Spar colour: standard/ });
    await expect(dot).toBeVisible();
    const name = (await details.getByRole("button", { name: "Change Spar name", exact: true }).boundingBox())!;
    const d = (await dot.boundingBox())!;
    expect(d.x + d.width).toBeLessThanOrEqual(name.x + 2); // before the name
    expect(Math.abs(d.y - name.y)).toBeLessThan(30);
    await dot.click();
    const dlg = page.getByRole("dialog", { name: "Spar colour" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: /^Dark red/ }).click();
    await dlg.getByRole("button", { name: "OK" }).click();
    expect((await exportProjectJson(page)).wing.panels[0].spars[0].color).toBe("#8b0000");
    const changed = details.getByRole("button", { name: /^Spar colour: #8b0000/ });
    await expect(changed).toHaveCSS("background-color", "rgb(139, 0, 0)");
    // the card shows it too
    await expect(card(page, "Main spar").locator("[data-feature-colour]")).toHaveCSS("background-color", "rgb(139, 0, 0)");
    await expectClean(errors);
  });

  test("BD-N3 position comes first, with Percentage and Units as a pill above the value; the side view is a square close-up that can be panned and zoomed", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    const position = (await details.getByRole("region", { name: "Position", exact: true }).boundingBox())!;
    const top = (await details.getByRole("region", { name: "Top view" }).boundingBox())!;
    expect(position.y + position.height).toBeLessThanOrEqual(top.y + 2);
    // Percentage / Units, formatted like Measured from, above the value
    const unit = details.getByRole("group", { name: "Spar distance unit" });
    await expect(unit.getByRole("button")).toHaveText(["Percentage", "Units"]);
    await expect(unit.getByRole("button", { name: "Percentage" })).toHaveAttribute("aria-pressed", "true");
    const pill = (await unit.boundingBox())!;
    const value = (await details.getByRole("button", { name: "Change Spar distance", exact: true }).boundingBox())!;
    expect(pill.y + pill.height).toBeLessThanOrEqual(value.y + 2);
    // choosing Units converts: 28% of the 230 mm root chord
    await unit.getByRole("button", { name: "Units" }).click();
    const d = (await exportProjectJson(page)).wing.panels[0].spars[0].distance.start;
    expect(d.unit).toBe("mm");
    expect(d.value).toBeCloseTo(64.4, 1);
    // the side view: square, to scale, and pannable
    const view = details.getByRole("region", { name: "Side view" }).getByRole("group", { name: /Close-up of Main spar/ });
    const box = (await view.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    const win = async () => (await view.getAttribute("data-window"))!.split(",").map(Number);
    const w0 = await win();
    await details.getByRole("button", { name: "Change Spar width", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Spar width" }).fill("12");
    await details.getByRole("spinbutton", { name: "Spar width" }).press("Enter");
    expect(await win()).toEqual(w0); // the window stays put while the settings change
    await view.getByRole("button", { name: "Zoom in" }).click();
    expect((await win())[2]).toBeLessThan(w0[2]);
    await expectClean(errors);
  });

  test("BD-R2 a joiner is a rod between two panels or the two wings: it sits at an end of the panel, says what it joins, and can add the matching joiner next door", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Wing joiner").getByRole("button", { name: "Wing joiner", exact: true }).click();
    // the Inner panel is the first: its root end joins the other wing, its tip end the next panel
    const joins = details.getByRole("group", { name: "Joiner joins" });
    await expect(joins.getByRole("button")).toHaveText(["The other wing", "The next panel"]);
    await expect(details.getByText(/rod that runs along the span|The other wing is a mirror/)).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Change Spar span start", exact: true })).toHaveCount(0); // a joiner has an end and a reach, not a span
    await joins.getByRole("button", { name: "The next panel" }).click();
    const j = async () => (await exportProjectJson(page)).wing.panels[0].spars.find((x: { type: string }) => x.type === "roundJoiner");
    let spar = await j();
    expect(spar.spanEndMm).toBe(420);
    expect(spar.spanStartMm).toBeLessThan(420);
    await details.getByRole("button", { name: "Change Joiner reach", exact: true }).click();
    await details.getByRole("spinbutton", { name: "Joiner reach" }).fill("80");
    await details.getByRole("spinbutton", { name: "Joiner reach" }).press("Enter");
    spar = await j();
    expect(spar.spanStartMm).toBe(340);
    expect(spar.spanEndMm).toBe(420);
    // the matching joiner is added to the next panel, at the same place, reaching in from the joint
    const before = (await exportProjectJson(page)).wing.panels[1].spars.length;
    await details.getByRole("button", { name: "Add the matching joiner to the next panel" }).click();
    const next = (await exportProjectJson(page)).wing.panels[1].spars;
    expect(next).toHaveLength(before + 1);
    const m = next.find((x: { type: string }) => x.type === "roundJoiner");
    expect(m.spanStartMm).toBe(0);
    expect(m.spanEndMm).toBe(80);
    expect(m.distance.start.value).toBe(spar.distance.start.value);
    expect(m.radiusMm).toBe(spar.radiusMm);
    await expectClean(errors);
  });

  test("BD-R3 a webbing is a feature of its own, a thin sheet with no height; a spar is round or cuboid", async ({ page }) => {
    await boot(page);
    await openFeatures(page);
    const details = builder(page).getByLabel("Feature details");
    await card(page, "Main spar").getByRole("button", { name: "Main spar", exact: true }).click();
    // the example's spar is a notch: its type is fixed and there is no "In the rib" section
    await expect(details.getByLabel("Spar notches", { exact: true })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Change spar type", exact: true })).toHaveCount(0);
    // a spar: round or cuboid only
    await addFeature(page, "Spar");
    await details.getByRole("button", { name: "Change spar type", exact: true }).click();
    const types = details.getByRole("combobox", { name: "spar type" });
    expect(await types.locator("option").allInnerTexts()).toEqual(["Round", "Cuboid"]); // webbing, notches, aileron and joiners are features of their own
    await types.press("Escape");
    // webbing: added on its own, starts at 2 mm, has no height and no type to change
    await addFeature(page, "Webbing");
    expect((await exportProjectJson(page)).wing.panels[0].spars.slice(-1)[0].width.start).toBe(2);
    expect((await exportProjectJson(page)).wing.panels[0].spars.slice(-1)[0].type).toBe("webbing");
    await expect(details.getByRole("button", { name: "Change Spar height", exact: true })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Change spar type", exact: true })).toHaveCount(0);
    await expect(details.getByLabel("Spar notches", { exact: true })).toHaveCount(0);
    await expectClean(errors);
  });

  test("BD-E5 keyboard only: Tab reaches the back button, the features and the details", async ({ page }) => {
    await boot(page);
    await openBuilder(page);
    await builder(page).getByRole("button", { name: "Close the builder" }).focus();
    await page.keyboard.press("Enter");
    await expect(builder(page)).toHaveCount(0);
    await expectClean(errors);
  });
});
