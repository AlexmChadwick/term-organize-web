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

test("degree plan PDF round-trip and a catalog audit", async ({ page }) => {
  const indexHtml = `<a href="/undergraduate/computer-information-science/computer-science/bscs/">Computer Science, BSCS</a>`;
  const programHtml = `
<html><body>
<div id="programrequirementstextcontainer" class="tab_content">
<p>Complete all courses listed below unless otherwise indicated.</p>
<h2>Major Requirements</h2>
<table class="sc_courselist"><tbody>
<tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Required Courses</span></td><td class="hourscol"></td></tr>
<tr class="odd"><td class="codecol"><a class="bubblelink code">CS&#160;3000</a></td><td>Algorithms and Data</td><td class="hourscol">4</td></tr>
<tr class="even lastrow"><td class="codecol"><a class="bubblelink code">CS&#160;4500</a></td><td>Software Development</td><td class="hourscol">4</td></tr>
</tbody></table>
</div>
</body></html>`;
  await page.route("**/api/catalog-site**", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url") ?? "";
    const body = target.includes("azindex") ? indexHtml : programHtml;
    await route.fulfill({ status: 200, contentType: "text/html", body });
  });

  await page.goto("/degree");
  await page.getByRole("button", { name: "New plan" }).click();
  await page.getByLabel("Plan name").fill("Audit plan");
  await page.getByPlaceholder("CS 2500").fill("CS 3000");
  await page.getByRole("button", { name: "Add completed" }).click();
  await expect(page.getByRole("link", { name: "CS 3000" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = await download.path();
  expect(pdfPath).toBeTruthy();

  await page.locator('input[type="file"]').setInputFiles(pdfPath!);
  await expect(page.getByText(/Imported/)).toBeVisible();
  await expect(page.getByRole("link", { name: "CS 3000" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Load programs" }).click();
  await page.getByRole("button", { name: "Computer Science, BSCS" }).click();
  await expect(page.getByText("Reading Computer Science, BSCS…")).toHaveCount(0);
  const requirement = page.locator("li").filter({ hasText: "CS 4500" });
  await expect(requirement.first()).toBeVisible();
  await expect(requirement.filter({ hasText: /complete|partial|missing|planned/ }).first()).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "CS 3000" }).filter({ hasText: /complete|partial|missing|planned/ }).first()).toBeVisible();
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
