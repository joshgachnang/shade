import {test, expect} from "@playwright/test";

test.describe("Feature: Logout", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test("user can log out from profile screen", async ({page}) => {
    await page.goto("/");
    await page.getByTestId("home-screen").waitFor({state: "visible"});

    // Navigate to profile tab
    await page.getByRole("tab", {name: "Profile"}).click();
    await page.getByTestId("profile-screen").waitFor({state: "visible"});

    // Verify profile data is displayed
    await expect(page.getByTestId("profile-name-text")).toBeVisible();
    await expect(page.getByTestId("profile-email-text")).toBeVisible();

    // Logout
    await page.getByTestId("profile-logout-button").click();

    // Should redirect to login screen
    await page.getByTestId("login-screen").waitFor({state: "visible", timeout: 10000});
  });
});
