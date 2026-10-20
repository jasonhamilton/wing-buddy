/** Number fields: the unit label and the spinner are part of the field, not decoration beside it. */
import { expect, test } from "@playwright/test";
import { boot, expectClean, guard, openPanel } from "./helpers";

test.describe("number field geometry", () => {
  test("U-1 unit cell and spinner are exactly as tall as the input, and line up across rows", async ({ page }) => {
    const errors: string[] = [];
    guard(page, errors);
    await boot(page);
    await openPanel(page, "Inner panel");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] input[role="spinbutton"]')].map((i) => {
        const row = i.parentElement!;
        const h = [...row.children].map((c) => Math.round(c.getBoundingClientRect().height));
        const kids = [...row.children].map((c) => c.getBoundingClientRect());
        return {
          label: i.getAttribute("aria-label"),
          heights: h,
          right: Math.round(kids[kids.length - 1].right),
          unitWidth: row.children.length === 3 ? Math.round(kids[1].width) : null,
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) expect(new Set(r.heights).size, `${r.label}: ${r.heights}`).toBe(1);
    // Every field in the form ends on the same line.
    expect(new Set(rows.map((r) => r.right)).size, JSON.stringify(rows.map((r) => [r.label, r.right]))).toBe(1);
    // "mm" and "deg" take the same room, so the numbers line up.
    expect(new Set(rows.filter((r) => r.unitWidth).map((r) => r.unitWidth)).size).toBe(1);
    await expectClean(errors);
  });
});
