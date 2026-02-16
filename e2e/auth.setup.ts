import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page}) => {
  await page.goto("/login");
  await page.getByTestId("login-screen").waitFor({state: "visible"});
  await page.getByTestId("login-email-input").fill("test@example.com");
  await page.getByTestId("login-password-input").fill("password123");
  await page.getByTestId("login-submit-button").click();
  await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 10000});
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
