import {test as setup, expect} from "@playwright/test";

setup("authenticate", async ({page, request}) => {
  // Allow up to 5 minutes: Metro bundle compilation (~2 min) +
  // font loading (~30s) + auth injection + verification
  setup.setTimeout(300000);

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

  // Pre-warm the Expo dev server: load /login and wait for full render.
  // In CI, Metro bundle compilation takes ~2 min and font loading adds ~30s.
  // This ensures tests that need the login screen don't hit timeout on first load.
  console.log("[Auth Setup] Pre-warming dev server by loading /login...");
  await page.goto("/login", {timeout: 180000});
  await page.getByTestId("login-screen").waitFor({state: "visible", timeout: 120000});
  console.log("[Auth Setup] Login screen pre-warmed successfully.");

  // Now navigate to root to inject auth state into localStorage
  await page.goto("/", {timeout: 60000});

  // Inject auth state into localStorage (matching @terreno/rtk persist format)
  await page.evaluate(
    ({token, refreshToken, userId}) => {
      const authState = {
        token,
        refreshToken,
        userId,
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
