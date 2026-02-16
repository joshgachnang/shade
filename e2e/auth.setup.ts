import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page}) => {
  // Sign up a test user (in CI, the database is fresh)
  await page.goto("/login");
  await page.getByTestId("login-screen").waitFor({state: "visible"});

  // Switch to signup mode
  await page.getByTestId("login-toggle-button").click();
  await page.getByTestId("login-name-input").waitFor({state: "visible"});

  // Fill signup form
  await page.getByTestId("login-name-input").fill("Test User");
  await page.getByTestId("login-email-input").fill("test@example.com");
  await page.getByTestId("login-password-input").fill("password123");
  await page.getByTestId("login-submit-button").click();

  // Wait for navigation to home after signup
  await page.waitForURL("**/", {timeout: 15000});
  await page.waitForLoadState("networkidle");

  // Save auth state
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
