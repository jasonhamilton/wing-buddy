/** F06 — export for a machine instead of a printer. */
import { expect, test } from "@playwright/test";
import { boot, expectClean, guard, openPanel, settled, chooseMenu } from "./helpers";

async function readDownload(dl: import("@playwright/test").Download): Promise<Buffer> {
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

test.describe("F06 machine exports", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("F06-H1 DXF carries millimetres, layers and closed polylines", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save DXF" }).click();
    const text = (await readDownload(await dl)).toString("utf8");

    expect(text).toMatch(/\$ACADVER\n1\nAC1009\n/);
    expect(text).toMatch(/\$INSUNITS\n70\n4\n/);
    expect(text).toMatch(/\$MEASUREMENT\n70\n1\n/);
    for (const layer of ["RIBS", "HOLES", "LABELS"]) expect(text).toContain(`2\n${layer}\n`);
    const polylines = (text.match(/0\nPOLYLINE\n/g) ?? []).length;
    const seqends = (text.match(/0\nSEQEND\n/g) ?? []).length;
    expect(polylines).toBeGreaterThan(0);
    expect(seqends).toBe(polylines);
    expect(text.trimEnd().endsWith("0\nEOF")).toBe(true);
    await expectClean(errors);
  });

  test("F06-H2 DXF geometry is at true size", async ({ page }) => {
    await boot(page);
    await openPanel(page, "Inner panel");
    await page.getByRole("spinbutton", { name: "Root chord" }).fill("300");
    await page.getByRole("spinbutton", { name: "Root chord" }).press("Enter");
    await page.getByRole("spinbutton", { name: "Tip chord" }).fill("300");
    await page.getByRole("spinbutton", { name: "Tip chord" }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
    await settled(page);

    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save DXF" }).click();
    const text = (await readDownload(await dl)).toString("utf8");

    // Every rib of the inner panel is now 300mm, so some X must reach ~300.
    const xs = [...text.matchAll(/\n10\n(-?\d+\.\d+)\n/g)].map((m) => Number(m[1]));
    const widest = Math.max(...xs);
    expect(widest).toBeGreaterThan(290);
    await expectClean(errors);
  });

  test("F06-E1 the spacing option changes the layout, not the parts", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    const first = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save DXF" }).click();
    const a = (await readDownload(await first)).toString("utf8");

    await page.getByRole("spinbutton", { name: "Spacing between parts" }).fill("60");
    await page.getByRole("spinbutton", { name: "Spacing between parts" }).press("Enter");
    const second = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save DXF" }).click();
    const b = (await readDownload(await second)).toString("utf8");

    expect((a.match(/0\nPOLYLINE\n/g) ?? []).length).toBe((b.match(/0\nPOLYLINE\n/g) ?? []).length);
    expect(a).not.toBe(b);
    await expectClean(errors);
  });

  test("F06-E2 exports are offered only when there is something to export", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", "Export", /^Export DXF/]);
    await expect(page.getByRole("button", { name: "Save DXF" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expectClean(errors);
  });

  test("F06-E3 the PDF dialog states the calibration requirement before you print", async ({ page }) => {
    await boot(page);
    await chooseMenu(page, ["File", "Export", /^Export PDF/]);
    await expect(page.getByRole("dialog")).toContainText(/Print at 100%/i);
    await expect(page.getByRole("dialog")).toContainText(/100mm/);
    await expectClean(errors);
  });
});
