import { expect, test } from "@playwright/test";

test("arrow keys move search results and sections only while that list is focused", async ({ page }) => {
  await page.goto("/search?q=cs");
  const results = page.getByRole("listbox", { name: "Search results" });
  const options = results.getByRole("option");
  await expect(options.first()).toBeVisible();
  await expect(results.getByRole("option", { selected: true })).toHaveCount(0);

  const search = page.getByRole("textbox", { name: "Search", exact: true });
  await search.focus();
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option", { selected: true })).toHaveCount(0);

  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("radio", { name: "Undergrad", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option", { selected: true })).toHaveCount(0);

  const first = options.first();
  const second = options.nth(1);
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first).toBeFocused();
  const details = page.getByRole("complementary", { name: "Course details" });
  const firstTitle = (await details.getByRole("heading").textContent()) ?? "";
  expect(firstTitle.length).toBeGreaterThan(0);

  await page.keyboard.press("ArrowDown");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(second).toBeFocused();
  await expect(first).toHaveAttribute("tabindex", "-1");
  await expect(second).toHaveAttribute("tabindex", "0");
  await expect(details.getByRole("heading")).not.toHaveText(firstTitle);
  await expect(second).toBeInViewport();

  await search.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(search).toBeFocused();

  await page.getByRole("radio", { name: "Grad", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toHaveAttribute("aria-selected", "true");

  await page.goto("/course/202710/CS/1800");
  const grid = page.getByRole("grid", { name: "Sections" });
  await expect(grid).toBeVisible();
  await expect(page.getByText(/Seats refreshed from Banner|Showing the snapshot until Banner answers/)).toBeVisible();
  const body = grid.getByRole("row").filter({ has: page.getByRole("gridcell") });
  await expect(body.nth(1)).toBeVisible();
  await expect(grid.getByRole("row", { selected: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add to schedule" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(grid.getByRole("row", { selected: true })).toHaveCount(0);

  const sectionDetails = page.getByRole("complementary", { name: "Section details" });
  await body.nth(0).getByRole("gridcell").nth(1).click();
  await expect(body.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(body.nth(0)).toBeFocused();
  const firstCrn = (await sectionDetails.getByText(/^CRN /).textContent()) ?? "";

  await page.keyboard.press("ArrowDown");
  await expect(body.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(body.nth(1)).toBeFocused();
  await expect(sectionDetails.getByText(/^CRN /)).not.toHaveText(firstCrn);
  await expect(body.nth(1)).toBeInViewport();

  await body.nth(1).getByRole("link").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(body.nth(1)).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Refresh seats" }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(body.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Refresh seats" })).toBeFocused();
});
