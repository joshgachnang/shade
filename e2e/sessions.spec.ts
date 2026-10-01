import {expect, type Page, test} from "@playwright/test";

// Navigation lives in a helper (not beforeEach) so a test can register a
// waitForResponse before the request that the navigation triggers.
const openSessionsScreen = async (page: Page): Promise<void> => {
  await page.goto("/", {timeout: 60000});
  await page.waitForLoadState("networkidle");

  const sessionsNav = page.getByRole("button", {name: "Sessions", exact: true});
  await sessionsNav.waitFor({state: "visible", timeout: 15000});
  await sessionsNav.click();
  await page.getByTestId("sessions-screen").waitFor({state: "visible", timeout: 15000});
};

test.describe("Feature: Zerg Sessions", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test("user can open the Sessions screen and see a list, empty state, or unreachable banner", async ({
    page,
  }) => {
    await openSessionsScreen(page);
    // With zerg unreachable the banner and the empty state render together,
    // so any one of the three states counts.
    await expect(
      page
        .getByTestId("sessions-list")
        .or(page.getByTestId("sessions-empty-state"))
        .or(page.getByTestId("sessions-error-banner"))
        .first()
    ).toBeVisible({timeout: 30000});
    await expect(page.getByTestId("sessions-refresh-button")).toBeVisible();
    await expect(page.getByTestId("sessions-summary")).toBeVisible({timeout: 30000});
  });

  test("sessions load from the API", async ({page}) => {
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/zerg/sessions") &&
        res.request().method() === "GET" &&
        res.status() === 200,
      {timeout: 60000}
    );
    await openSessionsScreen(page);
    const response = await responsePromise;
    const body = await response.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.inbox)).toBe(true);
    expect(typeof body.summary?.running).toBe("number");
  });

  test("refresh re-fetches the dashboard", async ({page}) => {
    await openSessionsScreen(page);
    await page.getByTestId("sessions-summary").waitFor({state: "visible", timeout: 30000});
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/zerg/sessions") && res.request().method() === "GET",
        {timeout: 60000}
      ),
      page.getByTestId("sessions-refresh-button").click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByTestId("sessions-refresh-button")).toHaveText("Refresh", {
      timeout: 30000,
    });
  });
});
