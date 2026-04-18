import {test, expect} from "@playwright/test";
import {openProfileTabAndWaitForMe} from "./helpers/auth";

test.describe("Feature: Logout", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test("user can log out from profile screen", async ({page}) => {
    test.slow();
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");

    await openProfileTabAndWaitForMe(page);

    // Verify profile data is displayed
    await expect(page.getByTestId("profile-name-text")).toBeVisible({timeout: 15000});
    await expect(page.getByTestId("profile-email-text")).toBeVisible();

    // Logout
    await page.getByTestId("profile-logout-button").click();

    // Wait for auth state to be cleared from localStorage, then reload
    await page.waitForFunction(
      () => {
        try {
          const stored = localStorage.getItem("persist:root");
          if (!stored) {
            return true;
          }
          const parsed = JSON.parse(stored);
          if (!parsed.auth) {
            return true;
          }
          const auth = JSON.parse(parsed.auth);
          return !auth.userId;
        } catch {
          return true;
        }
      },
      {timeout: 15000}
    );

    // Navigate to login since Expo Router doesn't auto-redirect after logout
    await page.goto("/login", {timeout: 60000});
    await expect(page.getByTestId("login-screen")).toBeVisible({timeout: 15000});
  });
});
