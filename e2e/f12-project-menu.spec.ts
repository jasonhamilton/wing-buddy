/** No Save: the project lives in the browser, Export writes a file, Import/Open replace the project, the name is editable. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, guard, openPanel, settled, statusBar } from "./helpers";

async function exportProject(page: Page): Promise<{ body: Buffer; name: string }> {
  const dl = page.waitForEvent("download");
  await chooseMenu(page, ["File", "Export", "Export Project"]);
  const d = await dl;
  const chunks: Buffer[] = [];
  for await (const c of await d.createReadStream()) chunks.push(c as Buffer);
  return { body: Buffer.concat(chunks), name: d.suggestedFilename() };
}

const projectName = (page: Page) => page.getByRole("button", { name: /^Project name/ });

async function setChord(page: Page, v: string) {
  await openPanel(page, "Inner panel");
  const c = page.getByRole("spinbutton", { name: "Root chord" });
  await c.fill(v);
  await c.press("Enter");
  await page.getByRole("button", { name: "Done" }).click();
  await settled(page);
}
const chordNow = async (page: Page) => {
  await openPanel(page, "Inner panel");
  const v = await page.getByRole("spinbutton", { name: "Root chord" }).inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  return v;
};

test.describe("no Save", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("PM-H1 there is no Save button, and File has no Save or Save as", async ({ page }) => {
    await boot(page);
    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await page.getByRole("button", { name: "File", exact: true }).click();
    const items = (await page.getByRole("menuitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    expect(items.filter((t) => /^Save/.test(t))).toEqual([]);
    for (const n of ["New…", "Open…", "Import", "Export"]) expect(items.some((t) => t.startsWith(n))).toBe(true);
    await expectClean(errors);
  });

  test("PM-H2 Ctrl+S does nothing: the app no longer claims the shortcut", async ({ page }) => {
    // If the app still claimed Ctrl+S it would call the file picker (Chromium) or start a download.
    await page.addInitScript(() => {
      (window as unknown as { pickerCalls: number }).pickerCalls = 0;
      (window as unknown as { showSaveFilePicker: () => Promise<never> }).showSaveFilePicker = () => {
        (window as unknown as { pickerCalls: number }).pickerCalls++;
        return Promise.reject(new Error("cancelled"));
      };
    });
    await boot(page);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await page.locator("main").click({ position: { x: 700, y: 300 } });
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(400);
    expect(downloaded).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { pickerCalls: number }).pickerCalls)).toBe(0);
    await expectClean(errors);
  });
});

test.describe("Import Project and Open replace the project", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const choose = async (page: Page, via: "import" | "open", body: Buffer, name = "other.wingbuddy.json") => {
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, via === "import" ? ["File", "Import", /^Import Project/] : ["File", /^Open/]);
    await (await chooser).setFiles({ name, mimeType: "application/json", buffer: body });
  };

  for (const via of ["import", "open"] as const) {
    test(`PM-H3 ${via}: asks, then loads the other project from scratch, not added to this one`, async ({ page }) => {
      await boot(page);
      const { body } = await exportProject(page); // 2 panels, root chord 230
      await setChord(page, "201");
      await page.getByRole("button", { name: "Edit Outer panel" }).waitFor();
      await choose(page, via, body);

      const dlg = page.getByRole("dialog", { name: "Replace this project?" });
      await expect(dlg).toContainText(/will be replaced/);
      await expect(dlg).toContainText(/Trainer 1200/);
      await dlg.getByRole("button", { name: /Replace and load/ }).click();
      await expect(dlg).toBeHidden();
      await settled(page);

      expect(await chordNow(page)).toBe("230.00");
      await expect(page.getByRole("button", { name: /^Edit Inner panel$/ })).toHaveCount(1); // not 2
      await expect(page.getByRole("button", { name: /^Edit Outer panel$/ })).toHaveCount(1);
      // from scratch: nothing from the old project in the history
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
      await expectClean(errors);
    });
  }

  test("PM-N1 Cancel (or Escape) keeps the current project", async ({ page }) => {
    await boot(page);
    const { body } = await exportProject(page);
    await setChord(page, "201");
    await choose(page, "import", body);
    await page.getByRole("dialog", { name: "Replace this project?" }).getByRole("button", { name: "Cancel" }).click();
    expect(await chordNow(page)).toBe("201.00");
    await choose(page, "open", body);
    await expect(page.getByRole("dialog", { name: "Replace this project?" })).toBeVisible(); // it appears after the file is read
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Replace this project?" })).toBeHidden();
    expect(await chordNow(page)).toBe("201.00");
    await expectClean(errors);
  });

  test("PM-N2 a file that is not a project is refused before anyone is asked anything", async ({ page }) => {
    await boot(page);
    await choose(page, "import", Buffer.from('{"hello":1}'), "x.json");
    await expect(page.locator("body")).toContainText(/Could not (import|open) that/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit Inner panel$/ })).toBeVisible();
    await expectClean(errors);
  });

  test("PM-E1 the replaced project is what a reload brings back", async ({ page }) => {
    await boot(page);
    const { body } = await exportProject(page);
    await setChord(page, "201");
    await choose(page, "import", body);
    await page.getByRole("button", { name: /Replace and load/ }).click();
    await settled(page);
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    expect(await chordNow(page)).toBe("230.00");
    await expectClean(errors);
  });
});

test.describe("project name", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("PM-H4 click the name, type a new one, Enter: header, tab title and export filename follow", async ({ page }, info) => {
    await boot(page);
    await projectName(page).click();
    const box = page.getByRole("textbox", { name: "Project name" });
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("Trainer 1200");
    await a11y(page, info, "PM-H4-rename");
    await box.fill("Slope Glider");
    await box.press("Enter");
    await expect(projectName(page)).toContainText("Slope Glider");
    await expect(page).toHaveTitle(/Slope Glider/);
    expect((await exportProject(page)).name).toMatch(/^Slope Glider\.wingbuddy\.json$/);
    await expectClean(errors);
  });

  test("PM-H5 keyboard only: the name is a tab stop, Enter edits, Enter commits", async ({ page }) => {
    await boot(page);
    await projectName(page).focus();
    await page.keyboard.press("Enter");
    const box = page.getByRole("textbox", { name: "Project name" });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Keys Only");
    await page.keyboard.press("Enter");
    await expect(projectName(page)).toContainText("Keys Only");
    await expect(projectName(page)).toBeFocused(); // focus goes back where it came from
    await expect(box).toHaveCount(0);
    await expectClean(errors);
  });

  test("PM-E2 Escape discards; clicking away keeps what was typed", async ({ page }) => {
    await boot(page);
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Discard me");
    await page.keyboard.press("Escape");
    await expect(projectName(page)).toContainText("Trainer 1200");

    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Kept by blur");
    await page.locator("main").click({ position: { x: 700, y: 300 } });
    await expect(projectName(page)).toContainText("Kept by blur");
    // and again: a cancel earlier must not have left anything stuck
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Third time");
    await page.keyboard.press("Escape");
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Fourth time");
    await page.locator("main").click({ position: { x: 700, y: 300 } });
    await expect(projectName(page)).toContainText("Fourth time");
    await expectClean(errors);
  });

  test("PM-E3 an empty or blank name is refused and the old one stays; spaces are trimmed", async ({ page }) => {
    await boot(page);
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("   ");
    await page.keyboard.press("Enter");
    await expect(projectName(page)).toContainText("Trainer 1200");
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("  Padded  ");
    await page.keyboard.press("Enter");
    await expect(projectName(page)).toHaveAccessibleName(/^Project name: Padded\. Click to rename\.$/);
    await expectClean(errors);
  });

  test("PM-E4 a very long name is capped, truncated in the header, and does not push the page sideways", async ({ page }) => {
    await boot(page);
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("W".repeat(300));
    await page.keyboard.press("Enter");
    const kept = (await projectName(page).getAttribute("title"))!;
    expect(kept.length).toBeLessThanOrEqual(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("PM-E5 renaming is one undo step, and the new name survives a reload", async ({ page }) => {
    await boot(page);
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Renamed");
    await page.keyboard.press("Enter");
    await chooseMenu(page, ["Edit", /^Undo rename project/]);
    await expect(projectName(page)).toContainText("Trainer 1200");
    await chooseMenu(page, ["Edit", /^Redo rename project/]);
    await expect(projectName(page)).toContainText("Renamed");
    await page.waitForTimeout(500);
    await page.reload();
    await settled(page);
    await expect(projectName(page)).toContainText("Renamed");
    await expectClean(errors);
  });

  test("PM-E6 the name works at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await projectName(page).click();
    await page.getByRole("textbox", { name: "Project name" }).fill("Phone");
    await page.keyboard.press("Enter");
    await expect(projectName(page)).toContainText("Phone");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });
});

test.describe("the unsaved marker, now that nothing is saved", () => {
  test("PM-H6 the dot means 'changed since last exported', and Export clears it", async ({ page }) => {
    const errors: string[] = [];
    guard(page, errors);
    await boot(page);
    await expect(projectName(page)).not.toContainText("•");
    await setChord(page, "222");
    await expect(projectName(page)).toContainText("•");
    await exportProject(page);
    await expect(projectName(page)).not.toContainText("•");
    await expect(statusBar(page)).toBeVisible();
    await expectClean(errors);
  });
});
