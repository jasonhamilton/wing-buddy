/** F01 — design a wing panel and export printable rib templates. The core loop. */
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { a11y, boot, expectClean, guard, openPanel, settled, statusBar, chooseMenu } from "./helpers";

test.describe("F01 core loop", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F01-H1 define a panel, generate ribs, export a PDF at true scale", async ({ page }, info) => {
    await boot(page);
    await expect(statusBar(page)).toContainText("17 ribs");

    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("260");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("tab", { name: "Ribs" }).click();
    await page.getByRole("spinbutton", { name: "Number of ribs" }).fill("11");
    await page.getByRole("spinbutton", { name: "Number of ribs" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("19 ribs");

    await chooseMenu(page, ["File", "Export", /^Export PDF/]);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save PDF" }).click();
    const file = await (await dl).createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of file) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);

    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    // A4 landscape, in points, exactly — not "about right".
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo((297 * 72) / 25.4, 3);
    expect(height).toBeCloseTo((210 * 72) / 25.4, 3);

    await a11y(page, info, "F01-H1-export-dialog");
    await expectClean(errors);
  });

  test("F01-H2 the whole loop is reachable by keyboard alone", async ({ page }) => {
    await boot(page);
    const stops: string[] = [];
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40) : "";
        }),
      );
    }
    expect(stops.some((s) => s === "File")).toBe(true);
    expect(stops.some((s) => s === "Edit")).toBe(true);
    expect(stops.some((s) => /Inner panel/.test(s))).toBe(true);

    await page.getByRole("button", { name: "Edit Inner panel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectClean(errors);
  });

  test("F01-E1 empty and junk input never commits a bad value", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });

    await chord.fill("");
    await chord.press("Enter");
    await expect(chord).toHaveValue("230.00"); // reverted, not zeroed

    await chord.fill("not a number");
    await chord.press("Enter");
    await expect(chord).toHaveValue("230.00");

    await chord.fill("-50");
    await chord.press("Enter");
    await expect(chord).toHaveValue("1.00"); // clamped to the minimum, not negative
    await expectClean(errors);
  });

  test("F01-E2 a partially typed number survives — 1 on the way to 150", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Root chord" });
    await chord.click();
    await chord.fill("");
    await page.keyboard.type("1", { delay: 60 });
    await expect(chord).toHaveValue("1");
    await page.keyboard.type("50", { delay: 60 });
    await expect(chord).toHaveValue("150");
    await chord.press("Enter");
    await expect(chord).toHaveValue("150.00");
    await expectClean(errors);
  });

  test("F01-E3 Escape reverts an edit, Enter commits it", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const sweep = page.getByRole("spinbutton", { name: "Sweep" });
    await sweep.fill("99");
    await sweep.press("Escape");
    await expect(sweep).toHaveValue("0.00");
    await sweep.fill("42");
    await sweep.press("Enter");
    await expect(sweep).toHaveValue("42.00");
    await expectClean(errors);
  });

  test("F01-E4 comma decimals and a unit suffix are accepted", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chord = page.getByRole("spinbutton", { name: "Tip chord" });
    await chord.fill("212,5");
    await chord.press("Enter");
    await expect(chord).toHaveValue("212.50");
    await chord.fill("180mm");
    await chord.press("Enter");
    await expect(chord).toHaveValue("180.00");
    await expectClean(errors);
  });

  test("F01-E5 a very long project name and accents do not break the shell", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const long = "Ailé Großsegler — ünïcode ✈ " + "x".repeat(140);
    const name = page.getByRole("textbox").first();
    await name.fill(long);
    await name.blur();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("F01-E7 reload mid-flow: nothing is silently lost or silently kept", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Dihedral" }).fill("9");
    await page.getByRole("spinbutton", { name: "Dihedral" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    await page.reload();
    await settled(page);
    // The app opens on the seed project; autosave is a crash net, not a session.
    // Whatever it shows must be coherent and must not be a half-applied edit.
    await openPanel(page, "Inner panel");
    const value = await page.getByRole("spinbutton", { name: "Dihedral" }).inputValue();
    expect(["2.00", "9.00"]).toContain(value);
    await expectClean(errors);
  });

  test("F01-E8 offline: the app keeps working, because nothing is remote", async ({ page, context }) => {
    await boot(page);
    await context.setOffline(true);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("240");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expect(statusBar(page)).toContainText("17 ribs");
    await context.setOffline(false);
    await expectClean(errors);
  });

  test("F01-N1 a rib wider than the page is reported, never silently shrunk", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("900");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("spinbutton", { name: "Tip chord" }).fill("900");
    await page.getByRole("spinbutton", { name: "Tip chord" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    await chooseMenu(page, ["File", "Export", /^Export PDF/]);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save PDF" }).click();
    await dl;
    await expect(page.getByRole("dialog")).toContainText(/wider than this page/i);
    await expectClean(errors);
  });

  test("F01-A1 no serious accessibility violations on the main screen", async ({ page }, info) => {
    await boot(page);
    await a11y(page, info, "F01-A1-plane-definition");
    await expectClean(errors);
  });
});
