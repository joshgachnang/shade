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

  // Click and wait for the actual API response
  const [signupResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/auth/signup"), {timeout: 15000}),
    page.getByTestId("login-submit-button").click(),
  ]);

  const signupOk = signupResponse.ok();
  console.log(`[Auth Setup] Signup response: ${signupResponse.status()}`);

  if (!signupOk) {
    console.log("[Auth Setup] Signup failed, falling back to login");

    // Switch to login mode
    await page.getByTestId("login-toggle-button").click();
    await page.getByTestId("login-name-input").waitFor({state: "hidden"});

    // Clear and re-fill for login
    await page.getByTestId("login-email-input").fill("");
    await page.getByTestId("login-email-input").fill("test@example.com");
    await page.getByTestId("login-password-input").fill("");
    await page.getByTestId("login-password-input").fill("password123");

    const [loginResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/auth/login"), {timeout: 15000}),
      page.getByTestId("login-submit-button").click(),
    ]);
    console.log(`[Auth Setup] Login response: ${loginResponse.status()}`);
  }

  // Wait for auth state change
  await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});

  // Save auth state
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
