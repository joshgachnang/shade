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

  // Run before any document scripts so redux-persist never flushes over a late write.
  // @terreno/rtk reads Bearer tokens from AsyncStorage (localStorage on web) as AUTH_TOKEN /
  // REFRESH_TOKEN; redux-persist only restores userId. Without the token keys, GET /auth/me
  // fails and the profile screen never leaves loading.
  await page.addInitScript(
    ({seedToken, seedRefreshToken, seedUserId}: {seedToken: string; seedRefreshToken: string; seedUserId: string}) => {
      localStorage.setItem("AUTH_TOKEN", seedToken);
      localStorage.setItem("REFRESH_TOKEN", seedRefreshToken);

      const authSliceState = {
        error: null,
        lastTokenRefreshTimestamp: null,
        userId: seedUserId,
      };

      localStorage.setItem("persist:root", JSON.stringify({
        auth: JSON.stringify(authSliceState),
        appState: JSON.stringify({}),
        _persist: JSON.stringify({version: 1, rehydrated: true}),
      }));
    },
    {seedToken: token, seedRefreshToken: refreshToken, seedUserId: userId}
  );

  await page.goto("/", {timeout: 60000});
  await page.waitForLoadState("networkidle");

  // Verify we're authenticated — login screen should not appear
  await expect(page.getByTestId("login-screen")).not.toBeVisible({timeout: 45000});

  // Save browser state for other tests
  await page.context().storageState({path: "./e2e/.auth/user.json"});
});
