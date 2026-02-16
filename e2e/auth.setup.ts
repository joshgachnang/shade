import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page}) => {
  setup.setTimeout(60000);

  // Log all API responses to help debug CI failures
  page.on("response", (response) => {
    if (response.url().includes("/auth/")) {
      console.log(`[Auth API] ${response.status()} ${response.url()}`);
      response
        .text()
        .then((body) => console.log(`[Auth API] Response: ${body}`))
        .catch(() => {});
    }
  });

  page.on("requestfailed", (request) => {
    console.log(`[Request Failed] ${request.url()} - ${request.failure()?.errorText}`);
  });

  // Sign up a test user (in CI, the database is fresh)
  await page.goto("/login", {timeout: 60000});
  await page.getByTestId("login-screen").waitFor({state: "visible"});

  // Switch to signup mode
  await page.getByTestId("login-toggle-button").click();
  await page.getByTestId("login-name-input").waitFor({state: "visible"});

  // Fill signup form
  await page.getByTestId("login-name-input").fill("Test User");
  await page.getByTestId("login-email-input").fill("test@example.com");
  await page.getByTestId("login-password-input").fill("password123");
  await page.getByTestId("login-submit-button").click();

  // Wait for the signup API response
  await page.waitForLoadState("networkidle");

  // Check if an error message appeared
  const errorVisible = await page.getByTestId("login-error-message").isVisible();
  if (errorVisible) {
    const errorText = await page.getByTestId("login-error-message").textContent();
    console.log(`[Auth Setup] Error message visible: ${errorText}`);
  }

  // Wait for auth state change — login screen should unmount
  await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});
  await page.waitForLoadState("networkidle");

  // Save auth state
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
