import {test, expect} from "@playwright/test";
import {testUsers} from "./helpers/test-data";

test.describe("Feature: Login", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("user can log in with valid credentials", async ({page}) => {
    await page.getByTestId("login-email-input").fill(testUsers.valid.email);
    await page.getByTestId("login-password-input").fill(testUsers.valid.password);
    await page.getByTestId("login-submit-button").click();
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 10000});
  });

  test("user sees error with invalid credentials", async ({page}) => {
    await page.getByTestId("login-email-input").fill(testUsers.invalid.email);
    await page.getByTestId("login-password-input").fill(testUsers.invalid.password);
    await page.getByTestId("login-submit-button").click();
    await page.getByTestId("login-error-message").waitFor({state: "visible"});
    await expect(page.getByTestId("login-error-message")).toBeVisible();
  });

  test("submit button is disabled when fields are empty", async ({page}) => {
    const submitButton = page.getByTestId("login-submit-button");
    await expect(submitButton).toBeDisabled();
  });

  test("submit button is disabled when only email is filled", async ({page}) => {
    await page.getByTestId("login-email-input").fill(testUsers.valid.email);
    const submitButton = page.getByTestId("login-submit-button");
    await expect(submitButton).toBeDisabled();
  });

  test("user can toggle to signup mode", async ({page}) => {
    await page.getByTestId("login-toggle-button").click();
    await expect(page.getByTestId("login-name-input")).toBeVisible();
    await expect(page.getByTestId("login-heading")).toContainText("Create Account");
  });

  test("user can toggle back to login mode from signup", async ({page}) => {
    await page.getByTestId("login-toggle-button").click();
    await expect(page.getByTestId("login-name-input")).toBeVisible();
    await page.getByTestId("login-toggle-button").click();
    await expect(page.getByTestId("login-name-input")).not.toBeVisible();
    await expect(page.getByTestId("login-heading")).toContainText("Welcome Back");
  });
});

test.describe("Feature: Signup", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-toggle-button").click();
    await page.getByTestId("login-name-input").waitFor({state: "visible"});
  });

  test("submit button is disabled when name is missing in signup mode", async ({page}) => {
    await page.getByTestId("login-email-input").fill(testUsers.signup.email);
    await page.getByTestId("login-password-input").fill(testUsers.signup.password);
    const submitButton = page.getByTestId("login-submit-button");
    await expect(submitButton).toBeDisabled();
  });

  test("user can sign up with valid details", async ({page}) => {
    const signupEmail = `signup-${Date.now()}@example.com`;
    await page.getByTestId("login-name-input").fill(testUsers.signup.name);
    await page.getByTestId("login-email-input").fill(signupEmail);
    await page.getByTestId("login-password-input").fill(testUsers.signup.password);
    await page.getByTestId("login-submit-button").click();
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 10000});
  });
});
