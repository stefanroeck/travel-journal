import { expect, test } from "@playwright/test";

test.describe("Travel Journal app", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads the main page and shows the app title", async ({ page }) => {
    await expect(page.locator("h1#travel-title")).toHaveText("Meine Reiseroute");
  });

  test("opens the travel menu and reveals the current travel option", async ({ page }) => {
    await expect(page.locator("h1#travel-title")).toHaveText("Menorca 2026");
    await page.click("#travel-menu-button");

    const menu = page.locator("#travel-menu");

    await expect(menu).toBeVisible();
    await expect(menu).toContainText("Menorca 2026");
  });
});
