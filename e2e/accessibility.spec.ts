import {test, expect} from "@playwright/test";
import {testUsers} from "./helpers/test-data";

test.describe("Feature: Accessibility - Login Form Keyboard Navigation", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("login form is fully navigable by keyboard", async ({page}) => {
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
    await page.keyboard.press("Enter");

    // Wait for login to complete — login screen should disappear
    await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});
  });
});
