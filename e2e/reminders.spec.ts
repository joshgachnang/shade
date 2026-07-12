import {expect, test} from "@playwright/test";

test.describe("Feature: Reminders", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");

    const remindersNav = page.getByRole("button", {name: "Reminders", exact: true});
    await remindersNav.waitFor({state: "visible", timeout: 15000});
    await remindersNav.click();
    await page.getByTestId("reminders-screen").waitFor({state: "visible", timeout: 15000});
  });

  test("user can open the Reminders screen and see list or empty state", async ({page}) => {
    // Either synced reminders render or the empty state shows — both are valid.
    await expect(
      page.getByTestId("reminders-list").or(page.getByTestId("reminders-empty-state"))
    ).toBeVisible({timeout: 15000});
  });

  test("reminders load from the API", async ({page}) => {
    const response = await page.waitForResponse(
      (res) =>
        res.url().includes("/reminders") &&
        res.request().method() === "GET" &&
        res.status() === 200,
      {timeout: 30000}
    );
    expect(response.ok()).toBe(true);
  });

  test("user can open the add-reminder modal", async ({page}) => {
    await page.getByTestId("reminders-add-button").click();
    await page.getByTestId("reminders-add-modal").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("reminders-add-title")).toBeVisible();
    await expect(page.getByTestId("reminders-add-due")).toBeVisible();
  });

  test("add-reminder submit stays disabled until a title is entered", async ({page}) => {
    await page.getByTestId("reminders-add-button").click();
    await page.getByTestId("reminders-add-modal").waitFor({state: "visible", timeout: 15000});

    const submit = page.getByRole("button", {name: "Add Reminder", exact: true}).last();
    await expect(submit).toBeDisabled();

    await page.getByTestId("reminders-add-title").fill("Test reminder");
    await expect(submit).toBeEnabled();
  });

  test("user can dismiss the add-reminder modal", async ({page}) => {
    await page.getByTestId("reminders-add-button").click();
    await page.getByTestId("reminders-add-modal").waitFor({state: "visible", timeout: 15000});

    await page.getByRole("button", {name: "Cancel", exact: true}).click();
    await page.getByTestId("reminders-add-modal").waitFor({state: "hidden", timeout: 15000});
  });
});
