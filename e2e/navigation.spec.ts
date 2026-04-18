import {test, expect} from "@playwright/test";
import type {Page} from "@playwright/test";

const openProfileTabAndWaitForProfile = async (page: Page): Promise<void> => {
  const profileTab = page.getByRole("tab", {name: "Profile"});
  await profileTab.waitFor({state: "visible", timeout: 15000});
  await profileTab.click();
  await page.getByTestId("profile-name-text").waitFor({state: "visible", timeout: 30000});
};

test.describe("Feature: Tab Navigation", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");
  });

  test("user can switch from Home to Profile tab", async ({page}) => {
    await openProfileTabAndWaitForProfile(page);
    await expect(page.getByTestId("profile-name-text")).toBeVisible({timeout: 15000});
  });

  test("user can switch from Home to Search tab", async ({page}) => {
    await page.getByRole("tab", {name: "Search"}).click();
    await page.getByTestId("search-screen").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("search-input")).toBeVisible({timeout: 15000});
  });

  test("user can switch from Profile back to Home tab", async ({page}) => {
    await openProfileTabAndWaitForProfile(page);
    await expect(page.getByTestId("profile-name-text")).toBeVisible({timeout: 15000});

    await page.getByRole("tab", {name: "Home"}).click();
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 15000});
  });
});

test.describe("Feature: Tab Navigation — profile API", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test("Profile tab loads the signed-in user via GET /auth/me", async ({page}) => {
    const profileMeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/auth/me") &&
        response.request().method() === "GET" &&
        response.status() === 200,
      {timeout: 60000}
    );

    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");

    const profileTab = page.getByRole("tab", {name: "Profile"});
    await profileTab.waitFor({state: "visible", timeout: 15000});
    await profileTab.click();
    await profileMeResponse;
    await expect(page.getByTestId("profile-name-text")).toBeVisible({timeout: 45000});
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
    await expect(page.getByTestId("login-screen")).toBeVisible({timeout: 60000});
    await expect(page.getByTestId("login-heading")).toContainText("Welcome Back");
    await context.close();
  });
});
