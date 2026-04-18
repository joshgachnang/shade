import {test, expect} from "@playwright/test";

const goToProfileTab = async (page: import("@playwright/test").Page): Promise<void> => {
  const meResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/me") && response.request().method() === "GET" && response.ok(),
    {timeout: 20000}
  );
  await page.getByRole("tab", {name: "Profile"}).click();
  await meResponse;
  await page.getByTestId("profile-screen").waitFor({state: "visible", timeout: 15000});
};

test.describe("Feature: Tab Navigation", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");
  });

  test("user can switch from Home to Profile tab", async ({page}) => {
    await goToProfileTab(page);
    await expect(page.getByTestId("profile-name-text")).toBeVisible({timeout: 15000});
  });

  test("user can switch from Home to Search tab", async ({page}) => {
    await page.getByRole("tab", {name: "Search"}).click();
    await page.getByTestId("search-screen").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("search-input")).toBeVisible({timeout: 15000});
  });

  test("user can switch from Profile back to Home tab", async ({page}) => {
    await goToProfileTab(page);

    await page.getByRole("tab", {name: "Home"}).click();
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 15000});
  });
});

test.describe("Feature: Auth Routing", () => {
  // This test is unreliable in CI due to Expo cold-start bundling times exceeding
  // the test timeout. The auth.setup.ts already verifies that unauthenticated state
  // shows the login screen as part of its flow.
  test.fixme("unauthenticated user is shown the login screen", async ({page}) => {
    test.slow();
    await page.goto("/", {timeout: 60000});
    await page.getByTestId("login-screen").waitFor({state: "visible", timeout: 60000});
    await expect(page.getByTestId("login-heading")).toContainText("Welcome Back");
  });

  test("authenticated user bypasses login and sees Home", async ({browser}) => {
    const context = await browser.newContext({storageState: "./e2e/.auth/user.json"});
    const page = await context.newPage();
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});
    await context.close();
  });

  test("unauthenticated user visiting Profile URL is redirected to login", async ({browser}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/profile", {timeout: 60000});
    await page.waitForLoadState("networkidle");
    await page.getByTestId("login-screen").waitFor({state: "visible", timeout: 60000});
    await expect(page.getByTestId("login-heading")).toContainText("Welcome Back");
    await context.close();
  });
});
