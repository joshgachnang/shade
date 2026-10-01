import {expect, type Page, test} from "@playwright/test";

const feature = (overrides: Record<string, unknown> = {}) => ({
  _id: "brewery-feature",
  id: "brewery-feature",
  name: "Example feature",
  status: "awaiting_approval",
  steps: [],
  currentStepIndex: 0,
  created: "2026-09-30T00:00:00Z",
  updated: "2026-09-30T00:00:00Z",
  brewery: {
    slug: "example",
    repo: "example/repo",
    phase: "review",
    pr: 42,
    prUrl: "https://example.invalid/pull/42",
  },
  ...overrides,
});

const openFeatures = async (page: Page, data: ReturnType<typeof feature>[]) => {
  await page.route("**/features*", async (route) => {
    if (route.request().resourceType() === "document") return route.continue();
    await route.fulfill({json: {data, limit: 100, more: false, total: data.length}});
  });
  await page.goto("/features", {waitUntil: "domcontentloaded"});
  await page.getByTestId("features-screen").waitFor({state: "visible", timeout: 45000});
};

test.describe("Features brewery progress", () => {
  test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem("AUTH_TOKEN", "test-token");
      localStorage.setItem(
        "persist:root",
        JSON.stringify({
          auth: JSON.stringify({userId: "test-user", error: null}),
          appState: JSON.stringify({}),
          _persist: JSON.stringify({version: 1, rehydrated: true}),
        })
      );
    });
    await page.route("**/auth/me", (route) =>
      route.fulfill({
        json: {
          data: {
            _id: "test-user",
            id: "test-user",
            name: "Test User",
            email: "test@example.invalid",
            admin: false,
          },
        },
      })
    );
  });

  test("shows approval and phase and opens the PR without opening feature details", async ({
    page,
    context,
  }) => {
    await context.route("https://example.invalid/**", (route) =>
      route.fulfill({body: "Example PR"})
    );
    await openFeatures(page, [feature()]);
    await expect(page.getByTestId("features-item-brewery-feature-status")).toHaveText(
      "awaiting approval"
    );
    await expect(page.getByTestId("features-item-brewery-feature-phase")).toHaveText(
      "Brewery: review"
    );
    const link = page.getByTestId("features-item-brewery-feature-pr");
    await expect(link).toHaveAccessibleName("Open PR #42");
    await expect(link).toHaveAttribute("href", "https://example.invalid/pull/42");
    await expect(link).toHaveAttribute("target", "_blank");
    const testInfo = test.info();
    if (testInfo.repeatEachIndex === 0) {
      await page.screenshot({path: testInfo.outputPath("features-brewery.png"), fullPage: true});
    }
    const popup = context.waitForEvent("page");
    await link.click();
    await expect(await popup).toHaveURL("https://example.invalid/pull/42");
    await expect(page).toHaveURL(/\/features$/);
  });
  test("legacy cards retain step progress and detail navigation without brewery fields", async ({
    page,
  }) => {
    const legacy = feature({
      brewery: undefined,
      status: "in_progress",
      steps: [
        {_id: "one", name: "First", status: "complete"},
        {_id: "two", name: "Second", status: "pending"},
      ],
      currentStepIndex: 1,
    });
    await openFeatures(page, [legacy]);
    const card = page.getByTestId("features-item-brewery-feature");
    await expect(card).toContainText("1 / 2 steps (50%)");
    await expect(card).toContainText("Current: Second");
    await expect(page.getByTestId("features-item-brewery-feature-phase")).toHaveCount(0);
    await expect(page.getByTestId("features-item-brewery-feature-pr")).toHaveCount(0);
    await page.route("**/features/brewery-feature", (route) => route.fulfill({json: legacy}));
    await card.click();
    await expect(page.getByTestId("feature-detail-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/features\/brewery-feature$/);
  });

  test("missing phase and PR are omitted while long phase and error text remain readable", async ({
    page,
  }) => {
    await openFeatures(page, [
      feature({brewery: {}, status: "error", errorMessage: "Brewery could not start"}),
      feature({_id: "long-feature", brewery: {phase: "Review <notes> & feedback ".repeat(10)}}),
    ]);
    await expect(page.getByTestId("features-item-brewery-feature")).toContainText(
      "Brewery could not start"
    );
    await expect(page.getByTestId("features-item-brewery-feature-phase")).toHaveCount(0);
    await expect(page.getByTestId("features-item-brewery-feature-pr")).toHaveCount(0);
    await expect(page.getByTestId("features-item-long-feature-phase")).toHaveText(
      "Brewery: " + "Review <notes> & feedback ".repeat(10).trim()
    );
  });

  test("missing, malformed and unsafe PR URLs show a plain PR number", async ({page}) => {
    await openFeatures(
      page,
      [undefined, "", "bad URL", "javascript:alert(1)", "file:///tmp/pr"].map((prUrl, i) =>
        feature({_id: `plain-${i}`, brewery: {pr: 42, prUrl}})
      )
    );
    for (let i = 0; i < 5; i++) {
      await expect(page.getByTestId(`features-item-plain-${i}-pr-number`)).toHaveText("PR #42");
      await expect(page.getByTestId(`features-item-plain-${i}-pr`)).toHaveCount(0);
    }
  });

  test("invalid PR numbers do not create links", async ({page}) => {
    await openFeatures(
      page,
      [0, -1, 1.5].map((pr, i) =>
        feature({_id: `invalid-${i}`, brewery: {pr, prUrl: "https://example.invalid/pull/42"}})
      )
    );
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId(`features-item-invalid-${i}`)).toBeVisible();
      await expect(page.getByTestId(`features-item-invalid-${i}-pr`)).toHaveCount(0);
      await expect(page.getByTestId(`features-item-invalid-${i}-pr-number`)).toHaveCount(0);
    }
  });

  test("shows loading followed by the empty state", async ({page}) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/features*", async (route) => {
      if (route.request().resourceType() === "document") return route.continue();
      await pending;
      await route.fulfill({json: {data: [], limit: 100, more: false, total: 0}});
    });
    await page.goto("/features", {waitUntil: "domcontentloaded"});
    await page.getByTestId("features-screen").waitFor({state: "visible", timeout: 45000});
    await expect(page.getByTestId("features-loading-spinner")).toBeVisible();
    release();
    await expect(page.getByTestId("features-empty-state")).toContainText("No features yet");
    await expect(page.getByTestId("features-loading-spinner")).toHaveCount(0);
  });

  test("PR link supports keyboard activation", async ({page, context}, testInfo) => {
    await context.route("https://example.invalid/**", (route) =>
      route.fulfill({body: "Example PR"})
    );
    await openFeatures(page, [feature()]);
    const link = page.getByTestId("features-item-brewery-feature-pr");
    await expect(link).toHaveAttribute("role", "link");
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute("href", "https://example.invalid/pull/42");
    await expect(link).toHaveAttribute("target", "_blank");
    const popup = context.waitForEvent("page");
    await page.keyboard.press("Enter");
    await expect(await popup).toHaveURL("https://example.invalid/pull/42");
    await expect(page).toHaveURL(/\/features$/);
  });
});
