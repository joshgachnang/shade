import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page}) => {
  setup.setTimeout(90000);

  // Log API responses for debugging
  page.on("response", (response) => {
    if (response.url().includes("/auth/")) {
      console.log(`[Auth API] ${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/login", {timeout: 60000});
  await page.getByTestId("login-screen").waitFor({state: "visible"});

  // Try to sign up first (for fresh CI databases)
  await page.getByTestId("login-toggle-button").click();
  await page.getByTestId("login-name-input").waitFor({state: "visible"});
  await page.getByTestId("login-name-input").fill("Test User");
  await page.getByTestId("login-email-input").fill("test@example.com");
  await page.getByTestId("login-password-input").fill("password123");
  await page.getByTestId("login-submit-button").click();

  // Wait for the API response
  await page.waitForLoadState("networkidle");

  // Check if signup failed (user already exists) — fall back to login
  const stillOnLogin = await page.getByTestId("login-screen").isVisible();
  if (stillOnLogin) {
    console.log("[Auth Setup] Signup failed or user exists, falling back to login");

    // Switch to login mode
    await page.getByTestId("login-toggle-button").click();
    await page.getByTestId("login-name-input").waitFor({state: "hidden"});

    // Clear and re-fill for login
    await page.getByTestId("login-email-input").fill("");
    await page.getByTestId("login-email-input").fill("test@example.com");
    await page.getByTestId("login-password-input").fill("");
    await page.getByTestId("login-password-input").fill("password123");
    await page.getByTestId("login-submit-button").click();

    await page.waitForLoadState("networkidle");
  }

  // Wait for auth state change
  await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});

  // Save auth state
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
