import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const CPS_NOTE = "Restricted to CPS (College of Professional Studies) students";

test("undergrad and grad filter combines with the other filters", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop screenshots only");
  await page.addInitScript(() => localStorage.setItem("term-organize.theme", "light"));
  await page.goto("/search?q=cs");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const panel = page.getByRole("radiogroup", { name: "Undergrad or grad" });
  await page.getByRole("radio", { name: "Undergrad", exact: true }).click();
  await expect.poll(async () => below5000(page)).toBe(true);
  await page.getByRole("checkbox", { name: "No prerequisites" }).check();
  await page.getByRole("checkbox", { name: "No corequisites" }).check();
  await expect.poll(async () => below5000(page)).toBe(true);

  await page.getByRole("radio", { name: "Grad", exact: true }).click();
  await expect.poll(async () => atLeast5000(page)).toBe(true);

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("level-filter-light.png");
  await panel.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/level-filter-light.png");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Grad", exact: true })).toBeChecked();
  const dark = testInfo.outputPath("level-filter-dark.png");
  await panel.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/level-filter-dark.png");

  await page.reload();
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("radio", { name: "Grad", exact: true })).toBeChecked();
});

test("a CPS-only course shows the restriction note", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop screenshots only");
  await page.addInitScript(() => localStorage.setItem("term-organize.theme", "light"));
  await page.route("**/api/catalog/202710", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: cpsCatalog() });
  });
  await page.goto("/search?q=ITC%201000");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const option = page.getByRole("option", { name: /ITC 1000/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText(CPS_NOTE);
  await option.click();
  const details = page.getByRole("complementary", { name: "Course details" });
  await expect(details).toContainText(CPS_NOTE);
  await expect(details.getByRole("heading", { name: "Computers and Society" })).toBeVisible();

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("cps-only-light.png");
  await option.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/cps-only-light.png");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(option).toContainText(CPS_NOTE);
  const dark = testInfo.outputPath("cps-only-dark.png");
  await option.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/cps-only-dark.png");
});

async function below5000(page: Page): Promise<boolean> {
  const numbers = await courseNumbers(page);
  return numbers.length > 0 && numbers.every((number) => number < 5000);
}

async function atLeast5000(page: Page): Promise<boolean> {
  const numbers = await courseNumbers(page);
  return numbers.length > 0 && numbers.every((number) => number >= 5000);
}

async function courseNumbers(page: Page): Promise<number[]> {
  const names = await page.getByRole("listbox", { name: "Search results" }).getByRole("option").allTextContents();
  return names.flatMap((name) => {
    const match = name.match(/CS (\d+)/);
    return match ? [Number(match[1])] : [];
  });
}

function cpsCatalog() {
  const course = {
    subject: "ITC",
    number: "1000",
    title: "Computers and Society",
    description: "A fixture course restricted to College of Professional Studies students.",
    minCredits: 4,
    maxCredits: 4,
    attributes: [],
    prereqs: null,
    coreqs: null,
    postreqs: [],
    specialTopics: false,
    detailsLoaded: true,
  };
  const restrictions = [{ kind: "must", category: "Levels", values: ["CPS - Undergraduate Semester (UC)"] }];
  const section = {
    crn: "34087",
    subject: "ITC",
    number: "1000",
    title: "Computers and Society",
    sectionNumber: "01",
    partOfTerm: "1",
    seatCapacity: 20,
    seatsRemaining: 5,
    enrollment: 15,
    waitlistCapacity: 0,
    waitlistCount: 0,
    waitlistRemaining: 0,
    classType: "Lecture",
    honors: false,
    campus: "Boston",
    meetings: [],
    crossListCRNs: [],
    attributes: [],
    restrictions,
  };
  return {
    version: 1,
    term: { code: "202710", bannerDescription: "Fall 2026 Semester" },
    generatedAt: 1,
    sectionsUpdatedAt: 1,
    courses: [course],
    sections: [section],
    subjects: [{ code: "ITC", name: "Information Technology" }],
    attributes: [],
    campuses: [],
  };
}
