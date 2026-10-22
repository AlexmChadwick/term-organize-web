import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("degree plan section picker in light and dark", async ({ page }, testInfo) => {
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
            id: "plan-double",
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
                    id: "row-cs-1800",
                    key: { subject: "CS", number: "1800" },
                    label: "CS 1800",
                    title: "CS 1800",
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

  const catalog = page.waitForResponse(
    (response) => response.url().includes("/api/catalog/202710") && response.request().method() === "GET" && response.ok(),
  );
  await page.goto("/degree");
  await catalog;
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByPlaceholder("CS 2500").fill("CS 1800");
  await page.getByRole("button", { name: "Add course" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Pick a section to add this course twice." })).toBeVisible();
  const existing = dialog.getByRole("group", { name: "Section for CS 1800 already in the plan" });
  const created = dialog.getByRole("group", { name: "Section for the new row" });
  await expect(existing.getByRole("radio").nth(1)).toBeVisible();
  await expect(existing.getByText("Akshar Varma").first()).toBeVisible();
  await expect(existing.getByText(/11:45/).first()).toBeVisible();

  mkdirSync("/opt/cursor/artifacts/screenshots", { recursive: true });
  const light = testInfo.outputPath("degree-double-light.png");
  await dialog.screenshot({ path: light });
  copyFileSync(light, "/opt/cursor/artifacts/screenshots/degree-double-light.png");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(dialog.getByRole("heading", { name: "Pick a section to add this course twice." })).toBeVisible();
  const dark = testInfo.outputPath("degree-double-dark.png");
  await dialog.screenshot({ path: dark });
  copyFileSync(dark, "/opt/cursor/artifacts/screenshots/degree-double-dark.png");

  await existing.getByRole("radio").nth(0).check();
  await created.getByRole("radio").nth(1).check();
  await dialog.getByRole("button", { name: "Add course" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/CRN \d+ · Discrete Structures/)).toHaveCount(2);
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.getByText(/CRN \d+ · Discrete Structures/)).toHaveCount(1);
});
