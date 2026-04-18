import type {Page} from "@playwright/test";

/**
 * Open the Profile tab and wait for either GET /auth/me or cached profile UI.
 * Races network vs RTK cache so Playwright does not hang when /auth/me is skipped.
 */
export const openProfileTabAndWaitForMe = async (page: Page): Promise<void> => {
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

/**
 * Wait for auth state to be persisted to localStorage after a login/signup
 * mutation completes. The RTK listener middleware stores tokens asynchronously,
 * and Redux persist writes state to localStorage async. This helper polls
 * localStorage until the userId appears in the persisted auth state.
 */
export const waitForAuthPersisted = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      try {
        const stored = localStorage.getItem("persist:root");
        if (!stored) {
          return false;
        }
        const parsed = JSON.parse(stored);
        if (!parsed.auth) {
          return false;
        }
        const auth = JSON.parse(parsed.auth);
        return !!auth.userId;
      } catch {
        return false;
      }
    },
    {timeout: 15000}
  );
};
