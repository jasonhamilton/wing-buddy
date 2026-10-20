/** Per-item colours: the colour dialog, and a part drawn in the colour it was given. */
import { expect, test, type Page } from "@playwright/test";
import { a11y, boot, chooseMenu, expectClean, exportProjectJson, guard, openPanel } from "./helpers";

const colourOf = async (page: Page) => (await exportProjectJson(page)).wing.panels[0].spars[0].color;
const custom = async (page: Page) => Number(await page.locator("[data-custom-coloured]").first().getAttribute("data-custom-coloured"));

async function openColour(page: Page) {
  await openPanel(page, "Inner panel");
  await page.getByRole("tab", { name: "Spars" }).click();
  await page.getByRole("button", { name: /^Spar colour: .* Change\.$/ }).click();
  return page.getByRole("dialog", { name: "Spar colour" });
}

test.describe("colour dialog", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("CL-H1 the spar's colour is a button showing the standard colour; it opens a picker with basic colours, mixers and custom slots", async ({ page }, info) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await expect(page.getByRole("button", { name: "Spar colour: standard. Change." })).toBeVisible();
    await page.getByRole("button", { name: "Spar colour: standard. Change." }).click();
    const dlg = page.getByRole("dialog", { name: "Spar colour" });
    await expect(dlg.getByRole("region", { name: "Basic colours" }).getByRole("button", { name: /#[0-9a-f]{6}$/ })).toHaveCount(32);
    for (const n of ["Hue", "Saturation", "Value"]) await expect(dlg.getByRole("slider", { name: n })).toBeVisible();
    for (const n of ["Red", "Green", "Blue"]) await expect(dlg.getByRole("spinbutton", { name: n })).toBeVisible();
    await expect(dlg.getByRole("textbox", { name: "HTML colour" })).toBeVisible();
    for (const n of ["OK", "Cancel", "Standard colour", "Add to custom colours"]) await expect(dlg.getByRole("button", { name: n })).toBeVisible();
    await a11y(page, info, "CL-H1-colour-dialog");
    await expectClean(errors);
  });

  test("CL-H2 pick a basic colour and OK: it is saved, shown on the button and the table, and drawn in 3D", async ({ page }) => {
    await boot(page);
    expect(await custom(page)).toBe(0);
    const dlg = await openColour(page);
    await dlg.getByRole("button", { name: /^Orange #ff6400$/ }).click();
    await expect(dlg.getByRole("img", { name: "Selected colour #ff6400" })).toBeVisible();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("button", { name: "Spar colour: #ff6400. Change." })).toBeVisible();
    await expect(page.getByRole("img", { name: "Colour #ff6400" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await colourOf(page)).toBe("#ff6400");
    await expect.poll(() => custom(page)).toBeGreaterThan(0);
    await expectClean(errors);
  });

  test("CL-H3 the HTML field and the red, green and blue fields stay in step; shorthand and capitals work", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    const hex = dlg.getByRole("textbox", { name: "HTML colour" });
    await hex.fill("#4CB84C");
    await expect(dlg.getByRole("spinbutton", { name: "Red" })).toHaveValue("76");
    await expect(dlg.getByRole("spinbutton", { name: "Green" })).toHaveValue("184");
    await expect(dlg.getByRole("spinbutton", { name: "Blue" })).toHaveValue("76");
    await expect(dlg.getByRole("img", { name: "Selected colour #4cb84c" })).toBeVisible();
    await hex.fill("#4b8");
    await expect(dlg.getByRole("img", { name: "Selected colour #44bb88" })).toBeVisible();
    const red = dlg.getByRole("spinbutton", { name: "Red" });
    await red.fill("255");
    await red.press("Enter");
    await expect(dlg.getByRole("img", { name: "Selected colour #ffbb88" })).toBeVisible();
    await expect(hex).toHaveValue("#ffbb88");
    await red.fill("999");
    await red.press("Enter");
    await expect(red).toHaveValue("255");
    await expectClean(errors);
  });

  test("CL-E1 something that is not a colour is refused with a reason, and the last good colour stays", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    const hex = dlg.getByRole("textbox", { name: "HTML colour" });
    await dlg.getByRole("button", { name: /^Red #ff0000$/ }).click();
    await hex.fill("banana");
    await expect(dlg.getByRole("alert")).toContainText("not a colour");
    await expect(dlg.getByRole("img", { name: "Selected colour #ff0000" })).toBeVisible();
    await hex.blur();
    await expect(hex).toHaveValue("#ff0000");
    await expect(dlg.getByRole("alert")).toHaveCount(0);
    await expectClean(errors);
  });

  test("CL-E2 the sliders move the colour: value 0 is black, and a grey has no saturation", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    await dlg.getByRole("slider", { name: "Value" }).fill("0");
    await expect(dlg.getByRole("img", { name: "Selected colour #000000" })).toBeVisible();
    await dlg.getByRole("slider", { name: "Value" }).fill("50");
    await dlg.getByRole("slider", { name: "Saturation" }).fill("0");
    await expect(dlg.getByRole("img", { name: "Selected colour #808080" })).toBeVisible();
    await expectClean(errors);
  });

  test("CL-E3 Cancel and Escape change nothing; Standard colour puts it back", async ({ page }) => {
    await boot(page);
    let dlg = await openColour(page);
    await dlg.getByRole("button", { name: /^Blue #0000ff$/ }).click();
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Spar colour: standard. Change." })).toBeVisible();
    await page.getByRole("button", { name: "Spar colour: standard. Change." }).click();
    dlg = page.getByRole("dialog", { name: "Spar colour" });
    await dlg.getByRole("button", { name: /^Blue #0000ff$/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Spar colour: standard. Change." })).toBeVisible();
    // now set one, then put it back
    await page.getByRole("button", { name: "Spar colour: standard. Change." }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Teal #006482$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Spar colour: #006482. Change." }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Standard colour" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await colourOf(page)).toBe("standard");
    await expect.poll(() => custom(page)).toBe(0);
    await expectClean(errors);
  });

  test("CL-E4 custom colours are kept: added, shown next time, newest first, no duplicates, at most eight", async ({ page }) => {
    await boot(page);
    let dlg = await openColour(page);
    const hex = dlg.getByRole("textbox", { name: "HTML colour" });
    for (const c of ["#111111", "#222222", "#333333", "#111111"]) {
      await hex.fill(c);
      await dlg.getByRole("button", { name: "Add to custom colours" }).click();
    }
    await expect(dlg.getByRole("region", { name: "Custom colours" }).getByRole("button", { name: /^Custom colour/ })).toHaveCount(3);
    await expect(dlg.getByRole("button", { name: "Custom colour 1: #111111" })).toBeVisible(); // the repeat moved to the front
    for (let i = 0; i < 9; i++) {
      await hex.fill(`#0${i}0${i}0${i}`);
      await dlg.getByRole("button", { name: "Add to custom colours" }).click();
    }
    await expect(dlg.getByRole("region", { name: "Custom colours" }).getByRole("button", { name: /^Custom colour/ })).toHaveCount(8);
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    dlg = await openColour(page);
    await expect(dlg.getByRole("region", { name: "Custom colours" }).getByRole("button", { name: /^Custom colour/ })).toHaveCount(8);
    await expectClean(errors);
  });

  test("CL-E5 choosing a colour is one undo step", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    await dlg.getByRole("button", { name: /^Yellow #ffff00$/ }).click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await chooseMenu(page, ["Edit", /^Undo spar colour/]);
    expect(await colourOf(page)).toBe("standard");
    await expectClean(errors);
  });

  test("CL-E6 the swatches are reachable and choosable from the keyboard", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    await dlg.getByRole("button", { name: /^Lime #a0ff00$/ }).focus();
    await page.keyboard.press("Enter");
    await expect(dlg.getByRole("img", { name: "Selected colour #a0ff00" })).toBeVisible();
    await expect(dlg.getByRole("button", { name: /^Lime #a0ff00$/ })).toHaveAttribute("aria-pressed", "true");
    await expectClean(errors);
  });

  test("CL-E7 a coloured spar survives save, reload and the ghost view", async ({ page }) => {
    await boot(page);
    const dlg = await openColour(page);
    await dlg.getByRole("button", { name: /^Purple #a000ff$/ }).click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("checkbox", { name: "Ghost the other panels" }).check();
    await page.waitForTimeout(400);
    await page.reload();
    await expect.poll(() => custom(page)).toBeGreaterThan(0);
    expect(await colourOf(page)).toBe("#a000ff");
    await expectClean(errors);
  });

  test("CL-E8 the picker fits at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await openColour(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await expectClean(errors);
  });
});
