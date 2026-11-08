import { expect, test } from "./fixtures";

test("homepage loads", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/.+/);
});
