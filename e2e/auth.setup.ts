import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page, request}) => {
  setup.setTimeout(90000);

  const baseApiUrl = "http://localhost:4020";

  // Create test user via API directly (faster and more reliable than UI)
  let token: string;
  let refreshToken: string;
  let userId: string;

  // Try signup first
  const signupRes = await request.post(`${baseApiUrl}/auth/signup`, {
    data: {email: "test@example.com", name: "Test User", password: "password123"},
  });

  if (signupRes.ok()) {
    const body = await signupRes.json();
    token = body.token;
    refreshToken = body.refreshToken;
    userId = body.userId;
    console.log(`[Auth Setup] Signup succeeded, userId: ${userId}`);
  } else {
    // User exists — log in instead
    console.log(`[Auth Setup] Signup returned ${signupRes.status()}, falling back to login`);
    const loginRes = await request.post(`${baseApiUrl}/auth/login`, {
      data: {email: "test@example.com", password: "password123"},
    });
    expect(loginRes.ok()).toBeTruthy();
    const body = await loginRes.json();
    token = body.token;
    refreshToken = body.refreshToken;
    userId = body.userId;
    console.log(`[Auth Setup] Login succeeded, userId: ${userId}`);
  }

  // Navigate to the app to set up the browser context
  await page.goto("/", {timeout: 60000});

  // Inject auth state into localStorage (matching @terreno/rtk persist format)
  await page.evaluate(
    ({token, refreshToken, userId}) => {
      const authState = {
        token,
        refreshToken,
        userId,
      };

      // The Redux persist key is "root" and auth is at the "auth" key
      const persistedState = {
        auth: authState,
        appState: {},
        _persist: {version: 1, rehydrated: true},
      };

      localStorage.setItem("persist:root", JSON.stringify({
        auth: JSON.stringify(authState),
        appState: JSON.stringify({}),
        _persist: JSON.stringify({version: 1, rehydrated: true}),
      }));
    },
    {token, refreshToken, userId}
  );

  // Reload to pick up the persisted state
  await page.reload({timeout: 60000});

  // Verify we're authenticated — login screen should not appear
  await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 15000});

  // Save browser state for other tests
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
