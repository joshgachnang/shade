import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page, request}) => {
  setup.setTimeout(180000);

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
    token = body.data.token;
    refreshToken = body.data.refreshToken;
    userId = body.data.userId;
    console.log(`[Auth Setup] Signup succeeded, userId: ${userId}`);
  } else {
    // User exists — log in instead
    console.log(`[Auth Setup] Signup returned ${signupRes.status()}, falling back to login`);
    const loginRes = await request.post(`${baseApiUrl}/auth/login`, {
      data: {email: "test@example.com", password: "password123"},
    });
    expect(loginRes.ok()).toBeTruthy();
    const body = await loginRes.json();
    token = body.data.token;
    refreshToken = body.data.refreshToken;
    userId = body.data.userId;
    console.log(`[Auth Setup] Login succeeded, userId: ${userId}`);
  }

  // Pre-warm the Expo dev server by loading the login page first.
  // In CI, the first page visit triggers bundling which can take 60+ seconds.
  // Loading /login here ensures the bundle is ready before actual tests run.
  await page.goto("/login", {timeout: 75000});
  await page.getByTestId("login-screen").waitFor({state: "visible", timeout: 75000});

  // Now navigate to root to inject auth state
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
