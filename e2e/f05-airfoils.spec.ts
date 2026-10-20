/** F05 — bring in your own airfoil. */
import { expect, test } from "@playwright/test";
import { boot, expectClean, guard, openPanel, settled, chooseMenu } from "./helpers";

/** A Selig-ordered NACA 0012, generated here so the fixture owes nobody anything. */
function seligDat(name: string, code = "0012", n = 60): string {
  const m = Number(code[0]) / 100;
  const p = Number(code[1]) / 10;
  const t = Number(code.slice(2)) / 100;
  const up: string[] = [];
  const lo: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0;
    let dy = 0;
    if (m > 0 && p > 0) {
      if (x < p) {
        yc = (m / (p * p)) * (2 * p * x - x * x);
        dy = ((2 * m) / (p * p)) * (p - x);
      } else {
        const q = (1 - p) * (1 - p);
        yc = (m / q) * (1 - 2 * p + 2 * p * x - x * x);
        dy = ((2 * m) / q) * (p - x);
      }
    }
    const th = Math.atan(dy);
    up.push(`  ${(x - yt * Math.sin(th)).toFixed(6)}  ${(yc + yt * Math.cos(th)).toFixed(6)}`);
    lo.push(`  ${(x + yt * Math.sin(th)).toFixed(6)}  ${(yc - yt * Math.cos(th)).toFixed(6)}`);
  }
  return [name, ...up.reverse(), ...lo.slice(1)].join("\n");
}

test.describe("F05 airfoils", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F05-H1 import a .dat file and use it on a panel", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles({
      name: "MH32.dat",
      mimeType: "text/plain",
      buffer: Buffer.from(seligDat("MH 32 TEST SECTION", "4412")),
    });
    await expect(page.locator("body")).toContainText(/Imported MH 32 TEST SECTION/i);

    await openPanel(page, "Inner panel");
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("MH 32");
    await expect(page.locator("body")).toContainText("1 of 10 airfoils");
    await page.getByRole("button", { name: /MH 32 TEST SECTION/ }).click();
    // The metrics panel must now describe the imported section, not the old one.
    await expect(page.getByRole("dialog")).toContainText("4.0%");
    await expectClean(errors);
  });

  test("F05-N1 a ragged file is refused with the offending line number", async ({ page }) => {
    await boot(page);
    const lines = seligDat("BROKEN FOIL").split("\n");
    lines[3] = "  0.5";
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles({
      name: "broken.dat",
      mimeType: "text/plain",
      buffer: Buffer.from(lines.join("\n")),
    });
    await expect(page.locator("body")).toContainText(/Could not read broken\.dat/i);
    await expect(page.locator("body")).toContainText(/Line 4/);
    await expectClean(errors);
  });

  test("F05-N2 a file that is not an airfoil at all is refused clearly", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles({
      name: "notes.dat",
      mimeType: "text/plain",
      buffer: Buffer.from("just some prose\nwith no numbers at all\n"),
    });
    await expect(page.locator("body")).toContainText(/Could not read notes\.dat/i);
    await expectClean(errors);
  });

  test("F05-N3 too few points is refused with the count", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles({
      name: "short.dat",
      mimeType: "text/plain",
      buffer: Buffer.from("SHORT\n1.0 0.0\n0.5 0.1\n0.0 0.0\n0.5 -0.1\n1.0 0.0\n"),
    });
    await expect(page.locator("body")).toContainText(/at least 20/i);
    await expectClean(errors);
  });

  test("F05-H2 a different tip section can be chosen and cleared", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("dialog")).toContainText("same as root");

    await page.getByRole("radio", { name: "Tip rib" }).check();
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("0009");
    await page.getByRole("button", { name: /NACA 0009/ }).click();
    await expect(page.getByRole("dialog")).not.toContainText("same as root");

    await page.getByRole("button", { name: /Use the root section at the tip/ }).click();
    await expect(page.getByRole("dialog")).toContainText("same as root");
    await expectClean(errors);
  });

  test("F05-H3 the thickness factor changes the rib, not just the number", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("dialog")).toContainText("12.0%");
    await page.getByRole("spinbutton", { name: "Root thickness factor" }).fill("1.5");
    await page.getByRole("spinbutton", { name: "Root thickness factor" }).press("Enter");
    // The read-out reflects the scaled section...
    await expect(page.getByRole("dialog")).toContainText("18.0%");
    // ...and so does the geometry: the rib preview is redrawn from the engine.
    await expect(page.getByRole("img", { name: /Rib outline/ })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);
    await expectClean(errors);
  });

  test("F05-E1 the filter reports when nothing matches and says what to do", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("textbox", { name: "Filter airfoils" }).fill("zzzz");
    await expect(page.locator("body")).toContainText("0 of 9 airfoils");
    await expect(page.getByRole("dialog")).toContainText(/Import a \.dat file/i);
    await expectClean(errors);
  });
});

/** The value shown beside a "Root section:" style label. */
const section = (page: import("@playwright/test").Page, label: string) =>
  page.locator("label", { hasText: label }).locator("xpath=following-sibling::div[1]");

/** Round four: the real sample file from the project folder, and what the user sees afterwards. */
test.describe("F05 import, as a user meets it", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });
  const sample = "seligdatfile.dat";

  test("F05-H2 an imported section is at the top of the list, where it can be seen", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles(sample);
    await expect(page.locator("body")).toContainText(/Imported RG 14 AIRFOIL/i);
    await openPanel(page, "Inner panel");
    // No filtering, no scrolling: the new section must already be on screen.
    await expect(page.getByRole("button", { name: /RG 14 AIRFOIL/ })).toBeInViewport();
    await expectClean(errors);
  });

  test("F05-H3 importing from inside the panel dialog applies it to the root rib", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import airfoil…" }).click();
    await (await chooser).setFiles(sample);
    await expect(section(page, "Root section:")).toContainText("RG 14 AIRFOIL");
    await expect(page.locator("body")).toContainText(/Imported RG 14 AIRFOIL\. It is now the root section/);
    await expectClean(errors);
  });

  test("F05-H4 with Tip rib selected, the import goes to the tip", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("radio", { name: "Tip rib" }).check();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import airfoil…" }).click();
    await (await chooser).setFiles(sample);
    await expect(section(page, "Tip section:")).toContainText("RG 14 AIRFOIL");
    await expect(section(page, "Root section:")).not.toContainText("RG 14");
    await expectClean(errors);
  });

  test("F05-E2 importing the same file twice does not pile up identical entries", async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 2; i++) {
      const chooser = page.waitForEvent("filechooser");
      await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
      await (await chooser).setFiles(sample);
      await expect(page.locator("body")).toContainText(/Imported RG 14 AIRFOIL|already/i);
    }
    await openPanel(page, "Inner panel");
    await expect(page.getByRole("button", { name: /RG 14 AIRFOIL/ })).toHaveCount(1);
    await expectClean(errors);
  });

  test("F05-N4 cancelling the file chooser changes nothing and says nothing", async ({ page }) => {
    await boot(page);
    const chooser = page.waitForEvent("filechooser");
    await chooseMenu(page, ["File", "Import", /^Import Airfoil/]);
    await (await chooser).setFiles([]);
    await page.waitForTimeout(300);
    await expect(page.locator("body")).not.toContainText(/Imported|Could not read/);
    await expectClean(errors);
  });
});
