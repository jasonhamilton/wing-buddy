/**
 * F01 continued — the project lifecycle.
 *
 * Saving and reopening is the one path where a mistake costs someone their
 * design rather than a redraw, and nothing covered it until now.
 */
import { expect, test } from "@playwright/test";
import { boot, expectClean, guard, openPanel, settled, statusBar, chooseMenu, startNewProject, menuItemDisabled } from "./helpers";

async function downloadProject(page: import("@playwright/test").Page): Promise<Buffer> {
  const dl = page.waitForEvent("download");
  await chooseMenu(page, ["File", "Export", "Export Project"]);
  const stream = await (await dl).createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** File > Open. A valid file asks before it replaces the project, so answer yes unless told this file is bad. */
async function openProject(page: import("@playwright/test").Page, name: string, body: Buffer, valid = true) {
  const chooser = page.waitForEvent("filechooser");
  await chooseMenu(page, ["File", /^Open/]);
  await (await chooser).setFiles({ name, mimeType: "application/json", buffer: body });
  if (valid) await page.getByRole("button", { name: /Replace and load/ }).click();
}

test.describe("F01 project lifecycle", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F01-H3 a project survives save and reopen unchanged", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("247");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("spinbutton", { name: "Dihedral" }).fill("4.5");
    await page.getByRole("spinbutton", { name: "Dihedral" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("Inner panel · 9 ribs · 2 spars");

    const saved = await downloadProject(page);
    expect(saved.length).toBeGreaterThan(500);

    // Wipe the slate, then reopen.
    await startNewProject(page);
    await settled(page);
    // New is the example wing again, so the edit is gone: the slate really was wiped.
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("230.00");
    await page.getByRole("button", { name: "Done" }).click();

    await openProject(page, "roundtrip.wingbuddy.json", saved);
    await expect(statusBar(page)).toContainText("Inner panel · 9 ribs · 2 spars");
    await settled(page);

    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("247.00");
    await expect(page.getByRole("spinbutton", { name: "Dihedral" })).toHaveValue("4.50");
    await expectClean(errors);
  });

  test("F01-H4 an imported airfoil travels inside the project file", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    const pts: string[] = ["TRAVELLING FOIL"];
    for (let i = 60; i >= 0; i--) {
      const x = (1 - Math.cos((Math.PI * i) / 60)) / 2;
      pts.push(`  ${x.toFixed(6)}  ${(0.06 * Math.sqrt(x) * (1 - x)).toFixed(6)}`);
    }
    for (let i = 1; i <= 60; i++) {
      const x = (1 - Math.cos((Math.PI * i) / 60)) / 2;
      pts.push(`  ${x.toFixed(6)}  ${(-0.06 * Math.sqrt(x) * (1 - x)).toFixed(6)}`);
    }
    await (await chooser).setFiles({
      name: "travel.dat",
      mimeType: "text/plain",
      buffer: Buffer.from(pts.join("\n")),
    });
    await expect(page.locator("body")).toContainText(/Imported TRAVELLING FOIL/i);

    await openPanel(page, "Inner panel");
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("TRAVELLING");
    await page.getByRole("button", { name: /TRAVELLING FOIL/ }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    const saved = await downloadProject(page);
    await startNewProject(page);
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("dialog")).not.toContainText("TRAVELLING FOIL"); // New starts without it
    await page.getByRole("button", { name: "Done" }).click();
    await openProject(page, "with-foil.wingbuddy.json", saved);
    await expect(statusBar(page)).toContainText("Inner panel");
    await settled(page);

    await openPanel(page, "Inner panel");
    await expect(page.getByRole("dialog")).toContainText("TRAVELLING FOIL");
    await expectClean(errors);
  });

  test("F01-E9 a long accented name survives the round trip", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const name = "Ailé Großsegler ✈ " + "långt".repeat(20);
    await page.getByRole("textbox").first().fill(name);
    await page.getByRole("textbox").first().blur();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    const saved = await downloadProject(page);
    await startNewProject(page);
    await settled(page);
    await expect(page.getByRole("button", { name: /^Edit Ailé/ })).toHaveCount(0); // the name is back to "Inner panel"
    await expect(page.getByRole("button", { name: "Edit Inner panel" })).toBeVisible();
    await openProject(page, "accents.wingbuddy.json", saved);
    await expect(page.getByRole("button", { name: /^Edit Ailé/ })).toBeVisible();
    await settled(page);
    await page.getByRole("button", { name: /^Edit Ailé/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("textbox").first()).toHaveValue(name);
    await expectClean(errors);
  });

  test("F01-N2 a corrupt project file is refused with a reason, and nothing is lost", async ({ page }) => {
    await boot(page);
    const before = await statusBar(page).innerText();
    await openProject(page, "broken.wingbuddy.json", Buffer.from("{ not json at all"), false);
    await expect(page.locator("body")).toContainText(/Could not open that file/i);
    await expect(page.locator("body")).toContainText(/not valid JSON/i);
    await expect(statusBar(page)).toContainText(before.split("·")[0].trim());
    await expectClean(errors);
  });

  test("F01-N3 valid JSON that is not a project is refused, naming the field", async ({ page }) => {
    await boot(page);
    const before = await statusBar(page).innerText();
    await openProject(page, "wrong.wingbuddy.json", Buffer.from(JSON.stringify({ hello: "world" })), false);
    await expect(page.locator("body")).toContainText(/does not match the project format/i);
    await expect(statusBar(page)).toContainText(before.split("·")[0].trim());
    await expectClean(errors);
  });

  test("F01-N4 a project with an impossible value is refused, not half-loaded", async ({ page }) => {
    await boot(page);
    const good = JSON.parse((await downloadProject(page)).toString("utf8"));
    good.wing.panels[0].lengthMm = -500; // schema says positive
    const before = await statusBar(page).innerText();
    await openProject(page, "bad-length.wingbuddy.json", Buffer.from(JSON.stringify(good)), false);
    await expect(page.locator("body")).toContainText(/does not match the project format/i);
    await expect(statusBar(page)).toContainText(before.split("·")[0].trim());
    await expectClean(errors);
  });

  test("F01-E10 two tabs editing at once do not corrupt each other", async ({ page, context }) => {
    await boot(page);
    const second = await context.newPage();
    const secondErrors: string[] = [];
    guard(second, secondErrors);
    await second.goto("/");
    await settled(second);

    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("201");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    await openPanel(second, "Inner panel");
    await second.getByRole("spinbutton", { name: "Root chord" }).fill("301");
    await second.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await second.getByRole("button", { name: "Done" }).click();
    await settled(second);

    // Each tab keeps its own document. Neither reaches across and changes the other.
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("201.00");
    await openPanel(second, "Inner panel");
    await expect(second.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("301.00");

    await expectClean(errors);
    await expectClean(secondErrors);
    await second.close();
  });

  test("F01-E11 undo walks back through a run of edits, redo walks forward", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    for (const v of ["240", "250", "260"]) {
      await chord.fill(v);
      await chord.press("Enter");
      await page.waitForTimeout(500); // past the 400ms coalescing window
    }
    await expect(chord).toHaveValue("260.00");
    await page.getByRole("button", { name: "Done" }).click();

    await chooseMenu(page, ["Edit", /^Undo/]);
    await chooseMenu(page, ["Edit", /^Undo/]);
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("240.00");

    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Redo/]);
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("250.00");
    await expectClean(errors);
  });

  test("F01-E12 a fresh edit after undo clears the redo stack", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    await chord.fill("240");
    await chord.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo/]);
    await settled(page);
    expect(await menuItemDisabled(page, "Edit", /^Redo/)).toBe(false);

    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Sweep" }).fill("12");
    await page.getByRole("spinbutton", { name: "Sweep" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await menuItemDisabled(page, "Edit", /^Redo/)).toBe(true);
    await expectClean(errors);
  });
});
