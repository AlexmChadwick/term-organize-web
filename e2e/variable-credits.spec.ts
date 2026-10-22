import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("variable-credit rows keep a chosen value in light and dark", async ({ page }, testInfo) => {
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
            id: "plan-credits",
            name: "Fixture",
            isPrimary: true,
            completed: [],
            terms: [
              {
                id: "fall-2026",
                season: "fall",
                year: 2026,
                courses: [
                  {
                    id: "readings",
                    key: { subject: "CS", number: "8982" },
                    label: "CS 8982",
                    title: "Readings",
                    credits: 4,
                    creditLow: 1,
                    creditHigh: 8,
                  },
                  {
                    id: "fundies",
                    key: { subject: "CS", number: "1800" },
                    label: "CS 1800",
                    title: "Discrete Structures",
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
  const stepper = page.getByRole("spinbutton", { name: "Credits: 4 (1 to 8)" });
  await expect(stepper).toBeVisible();
  await expect(page.getByRole("spinbutton")).toHaveCount(1);
  const semester = page.locator(".rounded-2xl", { has: page.getByRole("link", { name: "CS 8982" }) });
  await expect(semester.getByText("8 credits", { exact: true })).toBeVisible();

  await stepper.fill("2");
  const edited = page.getByRole("spinbutton", { name: "Credits: 2 (1 to 8)" });
  await expect(edited).toBeVisible();
  await expect(semester.getByText("6 credits", { exact: true })).toBeVisible();
  await expect(page.getByText("0 completed · 6 planned · 6 total credits")).toBeVisible();
  await edited.fill("9");
  await expect(page.getByRole("spinbutton", { name: "Credits: 8 (1 to 8)" })).toBeVisible();
  await expect(semester.getByText("12 credits", { exact: true })).toBeVisible();

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("variable-credits-light.png");
  await semester.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/variable-credits-light.png");

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("spinbutton", { name: "Credits: 8 (1 to 8)" })).toBeVisible();
  const dark = testInfo.outputPath("variable-credits-dark.png");
  await semester.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/variable-credits-dark.png");
});
