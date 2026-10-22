import { expect, test } from "@playwright/test";

test("no requisite filters in light and dark", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop screenshots only");
  await page.addInitScript(() => localStorage.setItem("term-organize.theme", "light"));
  await page.goto("/search");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("checkbox", { name: "No prerequisites" }).check();
  await page.getByRole("checkbox", { name: "No corequisites" }).check();
  await expect(page.getByRole("checkbox", { name: "No prerequisites" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "No corequisites" })).toBeChecked();
  await expect(page.getByText(/\d[\d,]* courses · showing/)).toBeVisible();
  const panel = page.locator(".card").first();
  await panel.screenshot({ path: testInfo.outputPath("req-filters-light.png") });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await panel.screenshot({ path: testInfo.outputPath("req-filters-dark.png") });
});
