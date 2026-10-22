import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const warning = "CS 4973 is in your plan more than once. That's fine for special topics; otherwise remove the extra copy.";

test("duplicate degree-plan rows warn in light and dark", async ({ page }, testInfo) => {
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
                    title: "Directed Study",
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
  await expect(page.getByText(warning)).toHaveCount(2);
  await expect(page.getByRole("link", { name: "CS 4973" })).toHaveCount(2);
  const editor = page.locator("section.card").first();

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("degree-duplicates-light.png");
  await editor.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/degree-duplicates-light.png");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText(warning)).toHaveCount(2);
  const dark = testInfo.outputPath("degree-duplicates-dark.png");
  await editor.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/degree-duplicates-dark.png");

  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.getByRole("link", { name: "CS 4973" })).toHaveCount(1);
  await expect(page.getByText(warning)).toHaveCount(0);
});
