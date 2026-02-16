import {test, expect} from "@playwright/test";

test.describe("Feature: Tab Navigation", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("user can switch from Home to Profile tab", async ({page}) => {
    await page.getByRole("tab", {name: "Profile"}).click();
    await page.getByTestId("profile-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("profile-name-text")).toBeVisible();
  });

  test("user can switch from Profile back to Home tab", async ({page}) => {
    await page.getByRole("tab", {name: "Profile"}).click();
    await page.getByTestId("profile-screen").waitFor({state: "visible"});

    await page.getByRole("tab", {name: "Home"}).click();
    await page.getByTestId("home-screen").waitFor({state: "visible"});
  });
});

test.describe("Feature: Auth Routing", () => {
  test("unauthenticated user is shown the login screen", async ({page}) => {
    await page.goto("/");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("login-heading")).toContainText("Welcome Back");
  });

  test("authenticated user bypasses login and sees Home", async ({browser}) => {
    const context = await browser.newContext({storageState: "./e2e/.auth/user.json"});
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("login-screen")).not.toBeVisible();
    await context.close();
  });
});
