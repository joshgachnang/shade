import {test, expect} from "@playwright/test";
import {waitForAuthPersisted} from "./helpers/auth";
import {testUsers} from "./helpers/test-data";

test.describe("Feature: Accessibility - Login Form Keyboard Navigation", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/login", {timeout: 60000});
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("login form is fully navigable by keyboard", async ({page}) => {
    test.slow();
    const emailInput = page.getByTestId("login-email-input");
    const passwordInput = page.getByTestId("login-password-input");
    const submitButton = page.getByTestId("login-submit-button");

    // Tab into the email field and fill it
    await emailInput.focus();
    await emailInput.fill(testUsers.valid.email);

    // Tab to password field and fill it
    await passwordInput.focus();
    await passwordInput.fill(testUsers.valid.password);

    // Tab to submit button and press Enter
    await submitButton.focus();
    await expect(submitButton).toBeFocused();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/auth/login") && res.status() === 200),
      page.keyboard.press("Enter"),
    ]);

    // Wait for auth state to persist, then navigate to root
    await waitForAuthPersisted(page);
    await page.goto("/", {timeout: 60000});
    await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});
  });
});
