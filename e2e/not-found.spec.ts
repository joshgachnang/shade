import {test, expect} from "@playwright/test";

test.describe("Feature: Not Found Screen", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test("invalid route shows the Not Found screen", async ({page}) => {
    await page.goto("/this-does-not-exist", {timeout: 60000});
    await page.getByTestId("not-found-screen").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("not-found-message")).toContainText("This screen doesn't exist.");
    await expect(page.getByTestId("not-found-home-link")).toBeVisible();
  });

  test("home link navigates away from the Not Found screen", async ({page}) => {
    await page.goto("/this-does-not-exist", {timeout: 60000});
    await page.getByTestId("not-found-screen").waitFor({state: "visible", timeout: 15000});
    await page.getByTestId("not-found-home-link").click();
    await expect(page.getByTestId("not-found-screen")).not.toBeVisible({timeout: 15000});
  });
});
