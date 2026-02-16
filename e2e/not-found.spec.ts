import {test, expect} from "@playwright/test";

test.describe("Feature: Not Found Screen", () => {
  test("invalid route shows the Not Found screen", async ({page}) => {
    await page.goto("/this-does-not-exist");
    await page.getByTestId("not-found-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("not-found-message")).toContainText("This screen doesn't exist.");
    await expect(page.getByTestId("not-found-home-link")).toBeVisible();
  });

  test("home link navigates away from the Not Found screen", async ({page}) => {
    await page.goto("/this-does-not-exist");
    await page.getByTestId("not-found-screen").waitFor({state: "visible"});
    await page.getByTestId("not-found-home-link").click();
    await page.getByTestId("not-found-screen").waitFor({state: "detached", timeout: 5000});
  });
});
