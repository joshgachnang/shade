import type {Page} from "@playwright/test";

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
