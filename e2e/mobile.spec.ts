/** The whole shell at phone width. Runs on the `mobile` project only. */
import { expect, test } from "@playwright/test";
import { a11y, expectClean, guard, settled } from "./helpers";

test.describe("mobile", () => {
  let errors: string[];
  test.beforeEach(({ page }) => {
    errors = [];
    guard(page, errors);
  });

  test("M-1 the page never scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expectClean(errors);
  });

  test("M-2 the wing is framed, not off-screen", async ({ page }) => {
    await page.goto("/");
    await settled(page);
    const canvas = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), parent: Math.round(c.parentElement!.getBoundingClientRect().width) };
    });
    expect(canvas).not.toBeNull();
    expect(canvas!.w).toBeLessThanOrEqual(canvas!.parent);
    await expectClean(errors);
  });

  test("M-3 the panel dialog is usable at phone width", async ({ page }, info) => {
    await page.goto("/");
    await settled(page);
    await page.getByRole("button", { name: "Edit Inner panel" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await a11y(page, info, "M-3-panel-dialog-mobile");
    await expectClean(errors);
  });

  test("M-4 the spar menu opens from its button on a phone and fits the screen", async ({ page }, info) => {
    await page.goto("/");
    await settled(page);
    await page.getByRole("button", { name: "Edit Inner panel" }).click();
    await page.getByRole("tab", { name: "Spars" }).click();
    await page.getByRole("button", { name: "Spar actions…" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await a11y(page, info, "M-4-spar-menu-mobile");
    await expectClean(errors);
  });
});
