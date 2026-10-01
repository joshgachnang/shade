import {expect, test} from "@playwright/test";

test.describe("Brewery admin configuration", () => {
  test("shows the brewery defaults in the App Config editor", async ({page, request}) => {
    const login = await request.post("http://127.0.0.1:4020/auth/login", {
      data: {email: "admin@shade-test.com", password: "TestPassword123!"},
    });
    expect(login.ok()).toBe(true);
    const {data}: {data: {token: string; refreshToken: string; userId: string}} = await login.json();
    await page.context().addInitScript(
      ({token, refreshToken, userId}) => {
        localStorage.setItem("AUTH_TOKEN", token);
        localStorage.setItem("REFRESH_TOKEN", refreshToken);
        localStorage.setItem("persist:root", JSON.stringify({
          auth: JSON.stringify({error: null, lastTokenRefreshTimestamp: null, userId}),
          appState: JSON.stringify({}),
          _persist: JSON.stringify({version: 1, rehydrated: true}),
        }));
      },
      {token: data.token, refreshToken: data.refreshToken, userId: data.userId}
    );

    await page.goto("/admin/AppConfig");
    const list = page.getByTestId("admin-list-AppConfig");
    await list.waitFor({state: "visible"});
    await list.getByText("Shade", {exact: true}).click();

    const breweryEditor = page.getByTestId("admin-field-brewery");
    await expect(breweryEditor).toBeVisible();

    const settings = JSON.parse(await breweryEditor.inputValue());
    expect(settings).toMatchObject({
      command: "brewery",
      pollIntervalMs: 5000,
      narrationFlushMs: 4000,
      maxNarrationLines: 8,
      agents: "",
      stepSilenceAlertMin: 30,
    });
    await expect(page.getByTestId("admin-save-button")).toBeVisible();
  });
});
