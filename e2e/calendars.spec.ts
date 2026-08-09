import {expect, test} from "@playwright/test";

test.describe("Feature: Calendar", () => {
  test.use({storageState: "./e2e/.auth/user.json"});

  test.beforeEach(async ({page}) => {
    await page.goto("/", {timeout: 60000});
    await page.waitForLoadState("networkidle");

    const calendarNav = page.getByRole("button", {name: "Calendar", exact: true});
    await calendarNav.waitFor({state: "visible", timeout: 15000});
    await calendarNav.click();
    await page.getByTestId("calendars-screen").waitFor({state: "visible", timeout: 15000});
  });

  test("user can open the Calendar screen and see events or empty state", async ({page}) => {
    await expect(
      page.getByTestId("calendars-list").or(page.getByTestId("calendars-empty-state"))
    ).toBeVisible({timeout: 15000});
  });

  test("calendar events load from the API", async ({page}) => {
    const response = await page.waitForResponse(
      (res) =>
        res.url().includes("/calendarEvents") &&
        res.request().method() === "GET" &&
        res.status() === 200,
      {timeout: 30000}
    );
    expect(response.ok()).toBe(true);
  });

  test("user can open the add-event modal", async ({page}) => {
    await page.getByTestId("calendars-add-button").click();
    await page.getByTestId("calendars-add-modal").waitFor({state: "visible", timeout: 15000});
    await expect(page.getByTestId("calendars-add-title")).toBeVisible();
    await expect(page.getByTestId("calendars-add-start")).toBeVisible();
    await expect(page.getByTestId("calendars-add-end")).toBeVisible();
  });

  test("add-event submit stays disabled until title and dates are entered", async ({page}) => {
    await page.getByTestId("calendars-add-button").click();
    await page.getByTestId("calendars-add-modal").waitFor({state: "visible", timeout: 15000});

    const submit = page.getByRole("button", {name: "Add Event", exact: true}).last();
    await expect(submit).toBeDisabled();

    await page.getByTestId("calendars-add-title").fill("Test event");
    await expect(submit).toBeDisabled();

    await page.getByTestId("calendars-add-start").fill("2026-08-01T09:00");
    await page.getByTestId("calendars-add-end").fill("2026-08-01T10:00");
    await expect(submit).toBeEnabled();
  });

  test("user can dismiss the add-event modal", async ({page}) => {
    await page.getByTestId("calendars-add-button").click();
    await page.getByTestId("calendars-add-modal").waitFor({state: "visible", timeout: 15000});

    await page.getByRole("button", {name: "Cancel", exact: true}).click();
    await page.getByTestId("calendars-add-modal").waitFor({state: "hidden", timeout: 15000});
  });
});
