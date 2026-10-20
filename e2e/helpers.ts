import { expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Every spec installs this. A console error or a 5xx is a test failure, not a
 * line of noise someone scrolls past.
 */
export function guard(page: Page, errors: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} on ${r.url()}`);
  });
}

export async function expectClean(errors: string[]) {
  expect(errors, `unexpected console or network errors:\n${errors.join("\n")}`).toEqual([]);
}

/** Wait for the geometry worker to settle — the status bar stops saying so. */
export async function settled(page: Page) {
  await expect(page.locator('footer[aria-label="Status"]')).not.toContainText("Recomputing", { timeout: 15_000 });
  await expect(page.locator('footer[aria-label="Status"]')).toContainText(/\d+ ribs/, { timeout: 15_000 });
}

export async function boot(page: Page) {
  await page.goto("/");
  await settled(page);
}

export async function a11y(page: Page, info: TestInfo, label: string) {
  const result = await new AxeBuilder({ page })
    // The 3D canvas is exempt from colour-contrast: it is a shaded render, not text.
    .disableRules([])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(result.violations, null, 2),
    contentType: "application/json",
  });
  expect(
    serious,
    `serious/critical axe violations on ${label}:\n` +
      serious.map((v) => `  ${v.id}: ${v.help} (${v.nodes.length} nodes)\n    ${v.nodes[0]?.html?.slice(0, 160)}`).join("\n"),
  ).toEqual([]);
}

/** Open the panel dialog for a named panel. */
export async function openPanel(page: Page, name: string) {
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

// By label, not "first footer": a dialog has a footer of its own.
export const statusBar = (page: Page) => page.locator('footer[aria-label="Status"]');

/**
 * Open a menu and walk down it: chooseMenu(page, ["File", "Export", /^Export PDF/]).
 * The first name is the menu button; the rest are items, each opening a submenu until the last.
 */
export async function chooseMenu(page: Page, path: (string | RegExp)[]) {
  const [menu, ...items] = path;
  await page.getByRole("button", { name: menu, exact: true }).click();
  for (const it of items) {
    await page.getByRole("menuitem", { name: it, exact: typeof it === "string" }).click();
  }
}

/** File > New, answering the confirmation the way a user who means it would. */
export async function startNewProject(page: Page) {
  await chooseMenu(page, ["File", /^New/]);
  await page.getByRole("button", { name: /Delete this project and start new/ }).click();
}

/** A menu item's state without choosing it: opens the menu, reads, closes with Escape. */
export async function menuItemDisabled(page: Page, menu: string, item: string | RegExp): Promise<boolean> {
  await page.getByRole("button", { name: menu, exact: true }).click();
  const el = page.getByRole("menuitem", { name: item });
  const disabled = (await el.getAttribute("aria-disabled")) === "true";
  await page.keyboard.press("Escape");
  return disabled;
}

/** One panel's card on Plane Definition. */
export const panelCard = (page: Page, name: string) => page.locator(`[data-panel-card="${name}"]`);

/**
 * The small + opens "Add a panel"; choose how the new panel starts (the suggested way if none is named)
 * and confirm. Every test that adds a panel goes through here, so the dialog is exercised too.
 */
export async function addPanel(page: Page, method?: "smart" | "mirror" | "direct") {
  await page.getByRole("button", { name: "Add panel", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Add a panel" });
  await expect(dlg).toBeVisible();
  if (method === "mirror") await dlg.getByRole("radio", { name: /Mirror/ }).check({ force: true });
  if (method === "direct") await dlg.getByRole("radio", { name: /Duplicate/ }).check({ force: true });
  await dlg.getByRole("button", { name: "Add panel" }).click();
  await expect(dlg).toBeHidden();
}

/** The project as JSON, by way of File > Export > Export Project: what is really stored, not what is on screen. */
export async function exportProjectJson(page: Page): Promise<any> {
  const dl = page.waitForEvent("download");
  await chooseMenu(page, ["File", "Export", "Export Project"]);
  const chunks: Buffer[] = [];
  for await (const c of await (await dl).createReadStream()) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/* ---- the rib table: a value is text until clicked ---- */
export const ribCell = (page: Page, label: string) => page.getByRole("button", { name: `Change ${label}`, exact: true });
/** Click a value in the rib table, type, Enter. */
export async function ribEdit(page: Page, label: string, value: string) {
  await ribCell(page, label).click();
  const f = page.getByRole("spinbutton", { name: label, exact: true });
  await f.fill(value);
  await f.press("Enter");
}
/** Choose a rib's type ("full", "front" or "rear"). */
export async function ribType(page: Page, n: number, value: string) {
  await ribCell(page, `Rib ${n} type`).click();
  const s = page.getByRole("combobox", { name: `Rib ${n} type`, exact: true });
  await s.selectOption(value);
  await s.press("Enter");
}
/** What a rib-table value says, e.g. "105.00mm". */
export const ribText = async (page: Page, label: string) => (await ribCell(page, label).innerText()).trim();
