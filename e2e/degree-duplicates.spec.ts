import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const header = "1 course appears more than once in this plan. Each copy still counts.";
const added = "Already in Fall 2026. Adding it again keeps both copies.";

test("duplicate degree-plan rows count and warn in light and dark", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop screenshots only");
  await page.addInitScript(() => {
    localStorage.setItem("term-organize.theme", "light");
    localStorage.setItem(
      "term-organize.user.v1",
      JSON.stringify({
        version: 1,
        preferences: { selectedTermCode: "202710" },
        degreePlans: [
          {
            id: "plan-duplicates",
            name: "Audit",
            isPrimary: true,
            completed: [],
            terms: [
              {
                id: "fall-2026",
                season: "fall",
                year: 2026,
                courses: [
                  {
                    id: "row-cs-4973",
                    key: { subject: "CS", number: "4973" },
                    label: "CS 4973",
                    title: "CS 4973",
                    credits: 4,
                  },
                ],
              },
            ],
            substitutions: [],
            courseEquivalences: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
  });

  await page.goto("/degree");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByPlaceholder("CS 2500").fill("CS 4973");
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByText(header)).toBeVisible();
  await expect(page.getByText(added)).toBeVisible();
  await expect(page.getByText("8 credits")).toBeVisible();
  await expect(page.getByRole("link", { name: "CS 4973", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "CS 4973 (2)", exact: true })).toBeVisible();
  const editor = page.locator("section.card").first();

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("degree-duplicates-light.png");
  await editor.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/degree-duplicates-light.png");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText(header)).toBeVisible();
  await expect(page.getByText(added)).toBeVisible();
  const dark = testInfo.outputPath("degree-duplicates-dark.png");
  await editor.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/degree-duplicates-dark.png");

  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "CS 4973", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "CS 4973 (2)", exact: true })).toHaveCount(0);
  await expect(page.getByText(header)).toHaveCount(0);
  await expect(page.getByText(added)).toHaveCount(0);
});
