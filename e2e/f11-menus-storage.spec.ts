/** The File and Edit menus, the New confirmation, and keeping the project in the browser. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, guard, menuItemDisabled, openPanel, settled, startNewProject } from "./helpers";

test.describe("menus", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const names = async (page: Page) => (await page.getByRole("menuitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

  test("MN-H1 File lists New, Open, Import and Export; Import and Export open submenus", async ({ page }, info) => {
    await boot(page);
    await page.getByRole("button", { name: "File", exact: true }).click();
    const top = await names(page);
    for (const n of ["New…", "Open…", "Import", "Export"]) expect(top.some((t) => t.startsWith(n)), `${n} in ${top}`).toBe(true);

    await page.getByRole("menuitem", { name: "Import", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Import" })).toBeVisible();
    expect(await page.getByRole("menu", { name: "Import" }).getByRole("menuitem").allInnerTexts()).toEqual(["Import Project…", "Import Airfoil…"]);

    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    expect(await page.getByRole("menu", { name: "Export" }).getByRole("menuitem").allInnerTexts()).toEqual(["Export PDF…", "Export DXF…", "Export OpenSCAD…", "Export Project"]);
    await a11y(page, info, "MN-H1-file-menu");
    await expectClean(errors);
  });

  test("MN-H2 Edit holds Undo and Redo, disabled until there is something to do, naming what they would do", async ({ page }) => {
    await boot(page);
    expect(await menuItemDisabled(page, "Edit", /^Undo/)).toBe(true);
    expect(await menuItemDisabled(page, "Edit", /^Redo/)).toBe(true);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    await chord.fill("240");
    await chord.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toBeEnabled;
    expect(await page.getByRole("menuitem", { name: /^Undo/ }).getAttribute("aria-disabled")).toBeNull();
    await expect(page.getByRole("menuitem", { name: /^Undo/ })).toContainText(/\w{3,}/);
    await page.keyboard.press("Escape");
    await expectClean(errors);
  });

  test("MN-H3 keyboard only: open, walk into a submenu, choose, and Escape steps back out", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "File", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: /^New/ })).toBeFocused();
    // walk to Export (the last item) and open it with the right arrow
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Export", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", { name: /^Export PDF/ })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("menuitem", { name: "Export", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter"); // Export PDF
    await expect(page.getByRole("dialog", { name: /PDF/i })).toBeVisible();
    await expectClean(errors);
  });

  test("MN-E1 Escape closes the menu and returns focus to its button; Left/Right move between menus", async ({ page }) => {
    await boot(page);
    const file = page.getByRole("button", { name: "File", exact: true });
    await file.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await expectClean(errors);
  });

  test("MN-E2 clicking away closes a menu without choosing anything", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "File", exact: true }).click();
    // the open menu covers the tab row, so click somewhere it does not
    await page.locator("main").click({ position: { x: 700, y: 300 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expectClean(errors);
  });

  test("MN-H4 Export Project downloads a project file", async ({ page }) => {
    await boot(page);
    const dl = page.waitForEvent("download");
    await chooseMenu(page, ["File", "Export", "Export Project"]);
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.wingbuddy\.json$/);
    const text = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
    expect(JSON.parse(text).wing.panels.length).toBeGreaterThan(0);
    await expectClean(errors);
  });

  test("MN-N2 New asks first, says the project will be deleted, and Cancel keeps it", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", /^New/]);
    const dlg = page.getByRole("dialog", { name: "Start a new project?" });
    await expect(dlg).toContainText(/will be deleted/);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("button", { name: /^Edit Inner panel$/ })).toBeVisible();
    // Escape is also a no
    await chooseMenu(page, ["File", /^New/]);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("button", { name: /^Edit Inner panel$/ })).toBeVisible();
    await expectClean(errors);
  });

  test("MN-H6 confirming New starts the example project, even when nothing has changed", async ({ page }) => {
    await boot(page);
    await startNewProject(page);
    await settled(page);
    await expect(page.getByRole("button", { name: "Edit Inner panel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Outer panel" })).toBeVisible();
    await expectClean(errors);
  });

  test("MN-A1 the menus are usable on a phone: submenus unfold inline and nothing is clipped", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    const item = page.getByRole("menuitem", { name: /^Export Project/ });
    await expect(item).toBeVisible();
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expectClean(errors);
  });
});

test.describe("storage", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("ST-H1 an edit survives a reload", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    await chord.fill("241.5");
    await chord.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("241.50");
    await expectClean(errors);
  });

  test("ST-H2 a reload straight after typing does not lose the last edit", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    await chord.fill("233");
    await chord.press("Enter");
    // inside the debounce window
    await page.reload();
    await settled(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("233.00");
    await expectClean(errors);
  });

  test("ST-H3 an imported airfoil and the title come back too", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles("seligdatfile.dat");
    await expect(page.locator("body")).toContainText(/Imported RG 14/);
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await expect(page).toHaveTitle("Wing Buddy - Trainer 1200");
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("button", { name: /RG 14 AIRFOIL/ })).toBeVisible();
    await expectClean(errors);
  });

  test("ST-H4 a new project is what comes back after a reload, not what was there before", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: /^Project name/ }).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Before New");
    await page.keyboard.press("Enter");
    await startNewProject(page);
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await expect(page.getByRole("button", { name: /^Project name/ })).not.toContainText("Before New");
    await expect(page.getByRole("button", { name: "Edit Outer panel" })).toBeVisible();
    await expectClean(errors);
  });

  test("ST-E1 stored data that is not a project is set aside, the example loads, and nothing crashes", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("wingbuddy.project.v1", '{"v":1,"doc":{"nonsense":true}}'));
    await page.goto("/");
    await settled(page);
    await expect(page.getByRole("button", { name: "Edit Inner panel" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("wingbuddy.project.unreadable"))).toContain("nonsense");
    await expectClean(errors);
  });

  test("ST-E2 stored data that is not even JSON is handled the same way", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("wingbuddy.project.v1", "{{{not json"));
    await page.goto("/");
    await settled(page);
    await expect(page.getByRole("button", { name: "Edit Inner panel" })).toBeVisible();
    await expectClean(errors);
  });

  test("ST-N1 when the browser refuses to store, the user is told once, and the app keeps working", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("full", "QuotaExceededError");
      };
    });
    await page.goto("/");
    await settled(page);
    await expect(page.locator("body")).toContainText(/storage is full/i);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("spinbutton", { name: "Root chord" })).toBeVisible();
    await expectClean(errors);
  });

  test("ST-E3 two tabs keep their own documents; a reload takes the newest write", async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await a.goto("/");
    await settled(a);
    await b.goto("/");
    await settled(b);
    await openPanel(a, "Inner panel");
    const chord = a.getByRole("spinbutton", { name: "Root chord" });
    await chord.fill("250");
    await chord.press("Enter");
    await a.waitForTimeout(600);
    // b has not been told: it still shows what it loaded
    await openPanel(b, "Inner panel");
    await expect(b.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("230.00");
    await b.reload();
    await settled(b);
    await openPanel(b, "Inner panel");
    await expect(b.getByRole("spinbutton", { name: "Root chord" })).toHaveValue("250.00");
    await ctx.close();
  });
});
