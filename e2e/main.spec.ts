import { expect, test } from "@playwright/test";

const NOTICE = "Not affiliated with, endorsed by, or sponsored by Northeastern University or Sandbox.";

test("home, search, and a course page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(NOTICE).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the term before Banner does it for you." })).toBeVisible();
  await page.getByLabel("Search courses").fill("CS 3000");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search\?q=CS(\+|%20)3000/);
  const course = page.getByRole("link", { name: /CS 3000/ }).first();
  await expect(course).toBeVisible();
  await course.click();
  await expect(page).toHaveURL(/\/course\/202710\/CS\/3000/);
  await expect(page.getByRole("heading", { name: "Algorithms and Data" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prerequisites" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
});

test("deep link to a section and the schedule builder", async ({ page }) => {
  await page.goto("/course/202710/CS/3000");
  await expect(page.getByRole("heading", { name: "Algorithms and Data" })).toBeVisible();
  const crn = page.locator("table a").first();
  await expect(crn).toBeVisible();
  const code = (await crn.textContent())?.trim();
  expect(code).toMatch(/^\d{5}$/);
  await page.goto(`/section/202710/${code}`);
  await expect(page.getByRole("heading", { name: /CS 3000/ })).toBeVisible();
  await page.getByRole("button", { name: "Add course" }).click();
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByText("CS 3000").first()).toBeVisible();
});

test("rooms, settings, and the license", async ({ page }) => {
  await page.goto("/rooms");
  await expect(page.getByRole("heading", { name: "Free rooms" })).toBeVisible();
  await expect(page.getByText(/free/).first()).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();
  await page.goto("/legal");
  await expect(page.getByText(NOTICE).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "GNU Affero General Public License v3.0" })).toBeVisible();
});

test("schedule generator and natural-language preferences", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await page.getByLabel("Add a course").fill("CS 3000");
  await page.getByRole("button", { name: /CS 3000 · Algorithms and Data/ }).click();
  await expect(page.getByRole("link", { name: "CS 3000" })).toBeVisible();
  await page.getByLabel("Describe the week").fill("no classes before 10am, Fridays off, prefer afternoons");
  await page.getByRole("button", { name: "Read that into preferences" }).click();
  await expect(page.getByText(/No classes before/)).toBeVisible();
  await page.getByRole("button", { name: "Generate schedules" }).click();
  await expect(page.getByText(/\d+ schedules? fit\.|don't share a conflict-free week|No section/)).toBeVisible();
});

test("degree plan, professors, and the watchlist", async ({ page }) => {
  await page.goto("/degree");
  await expect(page.getByRole("heading", { name: "Degree plan" })).toBeVisible();
  await page.getByRole("button", { name: "New plan" }).click();
  await expect(page.getByLabel("Plan name")).toBeVisible();
  await page.goto("/professors");
  await expect(page.getByRole("heading", { name: "Professors" })).toBeVisible();
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Seat alerts" })).toBeVisible();
});
