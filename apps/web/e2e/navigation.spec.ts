import { expect, test } from "@playwright/test";

test.describe("App Navigation & Responsive Shell", () => {
  test("switches between Chat and Document Upload views on desktop", async ({
    page,
  }) => {
    await page.goto("/chat");

    // Header title
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Interactive Chat"
    );

    // Click Document Upload in sidebar
    await page.getByRole("link", { name: /Document Upload/i }).click();
    await expect(page).toHaveURL(/\/upload/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Document Upload"
    );

    // Navigate back to Chat
    await page.getByRole("link", { name: /^Chat$/i }).click();
    await expect(page).toHaveURL(/\/chat/);
  });

  test("supports mobile drawer toggle on small viewports", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/chat");

    // Click hamburger / sidebar trigger
    const trigger = page.getByRole("button", { name: /Toggle Sidebar/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Mobile sheet drawer opens
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    // Click upload link inside drawer
    await drawer.getByRole("link", { name: /Document Upload/i }).click();
    await expect(page).toHaveURL(/\/upload/);
  });

  test("skip to main content link becomes focused on tab", async ({ page }) => {
    await page.goto("/chat");
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: /Skip to main content/i });
    await expect(skipLink).toBeFocused();
  });
});
