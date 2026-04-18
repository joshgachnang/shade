import {test, expect} from "@playwright/test";
import type {Page} from "@playwright/test";

const openProfileTabAndWaitForMe = async (page: Page): Promise<void> => {
  const profileTab = page.getByRole("tab", {name: "Profile"});
  await profileTab.waitFor({state: "visible", timeout: 15000});

  const meResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/me") &&
      response.request().method() === "GET" &&
      response.ok(),
    {timeout: 30000}
  );

  const profileReady = page.getByTestId("profile-name-text").waitFor({state: "visible", timeout: 30000});

  await profileTab.click();
  await Promise.race([meResponse, profileReady]);
};

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
