import {expect, test} from "@playwright/test";

test.describe("Feature: Console home", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 15000});
  });

  test("home page shows the Shade Console chat", async ({page}) => {
    // Status bar chrome + the chat composer are the console's signature.
    await expect(page.getByTestId("console-kill-button")).toBeVisible();
    await expect(page.getByTestId("console-alerts-button")).toBeVisible();
  });

  test("user can open console panes from the merged sidebar", async ({page}) => {
    const activityNav = page.getByRole("button", {name: "Activity", exact: true});
    await activityNav.waitFor({state: "visible", timeout: 15000});
    await activityNav.click();
    await page.getByTestId("console-activity-screen").waitFor({state: "visible", timeout: 15000});

    const approvalsNav = page.getByRole("button", {name: "Approvals", exact: true});
    await approvalsNav.click();
    await page.getByTestId("console-approvals-screen").waitFor({state: "visible", timeout: 15000});

    const systemNav = page.getByRole("button", {name: "System", exact: true});
    await systemNav.click();
    await page.getByTestId("console-system-screen").waitFor({state: "visible", timeout: 15000});
  });

  test("app pages remain reachable from the same sidebar", async ({page}) => {
    const remindersNav = page.getByRole("button", {name: "Reminders", exact: true});
    await remindersNav.waitFor({state: "visible", timeout: 15000});
    await remindersNav.click();
    await page.getByTestId("reminders-screen").waitFor({state: "visible", timeout: 15000});

    const homeNav = page.getByRole("button", {name: "Home", exact: true});
    await homeNav.click();
    await page.getByTestId("home-screen").waitFor({state: "visible", timeout: 15000});
  });

  test("/console redirects to the home page", async ({page}) => {
    await page.goto("/console", {timeout: 60000});
    // Expo-router can keep the previous stack entry mounted, so assert on the
    // URL plus the first matching screen rather than a strict single match.
    await page.waitForURL((url) => !url.pathname.includes("console"), {timeout: 15000});
    await expect(page.locator('[data-testid="home-screen"]:visible')).toBeVisible({
      timeout: 15000,
    });
  });

  test("console state survives navigating between panes", async ({page}) => {
    // Engage the kill switch (two clicks: arm, confirm) on Home…
    await page.getByTestId("console-kill-button").click();
    await page.getByTestId("console-kill-button").click();
    await expect(page.getByTestId("console-restore-button")).toBeVisible({timeout: 15000});

    // …navigate away and back: the shared vm keeps the killed state.
    await page.getByRole("button", {name: "Activity", exact: true}).click();
    await page.getByTestId("console-activity-screen").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("console-restore-button")).toBeVisible();

    // Restore so later tests see a live console.
    await page.getByTestId("console-restore-button").click();
    await expect(page.getByTestId("console-kill-button")).toBeVisible({timeout: 15000});
  });
});
