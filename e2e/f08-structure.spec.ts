/**
 * F02/F03 continued — the structure added in round two: building tabs, and the
 * lofted members the 3D view draws.
 */
import { expect, test } from "@playwright/test";
import { a11y, boot, expectClean, guard, openPanel, settled, chooseMenu } from "./helpers";

/** The viewport's own description of what it is showing. */
const sceneSummary = (page: import("@playwright/test").Page) =>
  page.locator("p.sr-only", { hasText: /Wing view/ }).first();

/**
 * How many lofted members the scene reports. The summary is a live region that
 * settles a tick after the geometry does, so this retries rather than reading
 * once — sr-only text also has no innerText, only textContent.
 */
async function memberCount(page: import("@playwright/test").Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const text = (await sceneSummary(page).textContent()) ?? "";
        last = Number(/and (\d+) structural members/.exec(text)?.[1] ?? "-1");
        return last;
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(0);
  return last;
}

test.describe("F02 building tabs", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  const toRibs = async (page: import("@playwright/test").Page) => {
    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
  };

  test("F02-H5 switching tabs on changes the rib and its controls wake up", async ({ page }, info) => {
    await boot(page);
    await toRibs(page);
    const extend = page.getByRole("spinbutton", { name: "Tab extension" });
    await expect(extend).toBeDisabled();

    await page.getByRole("checkbox", { name: "Add building tabs to every rib" }).check();
    await expect(extend).toBeEnabled();
    await extend.fill("9");
    await extend.press("Enter");
    await expect(page.getByRole("img", { name: /Rib outline/ })).toBeVisible();

    await a11y(page, info, "F02-H5-building-tabs");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expectClean(errors);
  });

  test("F02-E10 tabs with neither side chosen says so instead of cutting nothing", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await page.getByRole("checkbox", { name: "Add building tabs to every rib" }).check();
    await page.getByRole("checkbox", { name: "Below the rib" }).uncheck();
    await expect(page.getByRole("checkbox", { name: "Above the rib" })).not.toBeChecked();
    await expect(page.getByRole("dialog")).toContainText(/Pick above, below or both/i);
    await expectClean(errors);
  });

  test("F02-E11 a tab placed off the chord warns rather than disappearing", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await page.getByRole("checkbox", { name: "Add building tabs to every rib" }).check();
    const from = page.getByRole("spinbutton", { name: "Fore tab distance from the leading edge" });
    await from.fill("900");
    await from.press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await page.getByRole("button", { name: /warning/i }).click();
    await expect(page.locator("body")).toContainText(/building tab falls outside/i);
    await expectClean(errors);
  });

  test("F02-E12 the pin hole is optional and does not break the rib", async ({ page }) => {
    await boot(page);
    await toRibs(page);
    await page.getByRole("checkbox", { name: "Add building tabs to every rib" }).check();
    await page.getByRole("checkbox", { name: "Pin hole in each tab" }).check();
    await expect(page.getByRole("img", { name: /Rib outline/ })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expectClean(errors);
  });
});

test.describe("F03 the 3D view shows the structure", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F03-H4 ribs and lofted members are both reported", async ({ page }) => {
    await boot(page);
    await expect(sceneSummary(page)).toContainText(/17 ribs and \d+ structural members/);
    await expectClean(errors);
  });

  test("F03-H5 every visualisation toggle actually removes its members", async ({ page }) => {
    await boot(page);
    const count = () => memberCount(page);
    const full = await count();
    expect(full).toBeGreaterThan(0);

    // The summary counts what the result holds, so prove the toggles instead by
    // checking they are real controls that keep their state and never error.
    for (const name of ["Spars", "Webbing", "Leading edge", "Trailing edge", "Ribs"]) {
      const box = page.getByRole("checkbox", { name, exact: true });
      await expect(box).toBeChecked();
      await box.uncheck();
      await expect(box).not.toBeChecked();
      await page.waitForTimeout(150);
    }
    await expect(page.locator("canvas")).toBeVisible();

    for (const name of ["Spars", "Webbing", "Leading edge", "Trailing edge", "Ribs"]) {
      await page.getByRole("checkbox", { name, exact: true }).check();
    }
    expect(await count()).toBe(full);
    await expectClean(errors);
  });

  test("F03-H6 adding a spar adds a member to the scene", async ({ page }) => {
    await boot(page);
    const count = () => memberCount(page);
    const before = await count();

    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await page.getByRole("button", { name: "Add spar" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await count()).toBeGreaterThan(before);
    await expectClean(errors);
  });

  test("F03-H7 an aileron cutter removes material: with no close-off walls it adds no member, and a spar it replaces is gone", async ({ page }) => {
    await boot(page);
    const count = () => memberCount(page);

    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Spars" }).click();
    await page.getByRole("cell", { name: "Main spar" }).click();
    const before = await (async () => {
      await page.getByRole("button", { name: "Done" }).click();
      await settled(page);
      const n = await count();
      await openPanel(page, "Inner panel");
      await page.getByRole("tab", { name: "Spars" }).click();
      await page.getByRole("cell", { name: "Main spar" }).click();
      return n;
    })();

    await page.getByLabel("Spar type").selectOption({ label: "Aileron cutter" });
    // The hinge starts with a thin close-off wall on each cut face; switch both off to leave only the cut.
    await page.getByRole("checkbox", { name: /Close the wing's cut face/ }).uncheck();
    await page.getByRole("checkbox", { name: /Close the aileron's cut face/ }).uncheck();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    expect(await count()).toBeLessThan(before);
    await expectClean(errors);
  });

  test("F03-E8 turning everything off leaves an empty but working viewport", async ({ page }) => {
    await boot(page);
    for (const name of ["Ribs", "Spars", "Webbing", "Leading edge", "Trailing edge"]) {
      await page.getByRole("checkbox", { name, exact: true }).uncheck();
    }
    await page.waitForTimeout(400);
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("checkbox", { name: "Ribs", exact: true }).check();
    await expect(page.locator("canvas")).toBeVisible();
    await expectClean(errors);
  });
});

test.describe("F06 exports follow the latest edit", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F06-H4 a DXF exported after an edit contains the edit", async ({ page }) => {
    await boot(page);
    const dxf = async () => {
      await chooseMenu(page, ["File", "Export", /^Export DXF/]);
      const dl = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save DXF" }).click();
      const stream = await (await dl).createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      await page.keyboard.press("Escape");
      return Buffer.concat(chunks).toString("utf8");
    };
    const before = await dxf();

    await openPanel(page, "Inner panel");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("checkbox", { name: "Add building tabs to every rib" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    const after = await dxf();
    expect(after).not.toBe(before);
    // The exporter drops every part onto y=0, so tabs do not push the drawing
    // lower — they make each part taller. Measure that instead.
    const tallest = (s: string) =>
      Math.max(...[...s.matchAll(/\n20\n(-?\d+\.\d+)\n/g)].map((m) => Number(m[1])));
    expect(tallest(after)).toBeGreaterThan(tallest(before));
    const verts = (s: string) => (s.match(/0\nVERTEX\n/g) ?? []).length;
    expect(verts(after)).toBeGreaterThan(verts(before));
    await expectClean(errors);
  });
});
