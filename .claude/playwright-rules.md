# Playwright Rules for React Native Web

## Selector Strategy (STRICT)

1. **Always use `testID` → `getByTestId()`** as the primary selector. Every interactive or assertable element MUST have a `testID` prop.
2. **Never select by class name.** RNW generates hashed class names (`.css-abc123`) that change between builds.
3. **Never use deep structural selectors** like `div > div > div`. RNW's DOM structure is an implementation detail and changes between RN versions.
4. **Use `getByRole()` as a secondary strategy** when `testID` isn't available (e.g., third-party components).
5. **Use `getByText()` sparingly** — RNW wraps text in extra `<div>`s that can break text matching.

### Selector Anti-Patterns (Never Do These)

```ts
// ❌ Class names are generated — will break on rebuild
page.locator('.css-1a2b3c4')

// ❌ Deep structural selectors — RNW DOM structure is an implementation detail
page.locator('div > div > div > div[role="button"]')

// ❌ Index-based selectors without scoping — fragile
page.locator('div[role="button"]').nth(3)

// ✅ Instead, scope to a testID container, THEN narrow
page.getByTestId('user-list').getByRole('button', { name: 'Delete' })
```

## RNW DOM Awareness

React Native Web renders non-standard HTML. Know these mappings:

| RN Component        | DOM Output                          | Key Attribute            |
|----------------------|-------------------------------------|--------------------------|
| `<View>`             | `<div>`                             | —                        |
| `<Text>`             | `<div role="text">` or `<span>`     | `dir="auto"`             |
| `<Pressable>`        | `<div role="button" tabindex="0">`  | `aria-disabled`, cursor  |
| `<TouchableOpacity>` | `<div role="button">`               | `tabindex="0"`           |
| `<TextInput>`        | `<input>` or `<textarea>`           | standard HTML input      |
| `<Image>`            | `<img>` or `<div>` with background  | `role="img"`             |
| `<ScrollView>`       | `<div>` with overflow styles        | —                        |
| `<FlatList>`         | `<div>` containing item divs        | —                        |
| `<Switch>`           | `<div role="switch">`               | `aria-checked`           |
| `<ActivityIndicator>`| `<div role="progressbar">`          | `aria-valuetext`         |

## Waiting & Async (MANDATORY)

**NEVER use `waitForTimeout()` — it causes flaky tests.**

### Navigation
```ts
await page.getByTestId('go-to-settings').click();
await page.getByTestId('settings-screen').waitFor({ state: 'visible' });
// URL-based waits if also needed:
await page.waitForURL('**/settings');
```

### Data Loading
```ts
// Wait for content to appear
await page.getByTestId('dashboard-content').waitFor({ state: 'visible' });
// Or wait for spinner to disappear
await page.getByTestId('loading-spinner').waitFor({ state: 'hidden' });
// Or wait for network
await page.waitForLoadState('networkidle');
```

### Animations
```ts
// Wait for final state, not just DOM presence
await expect(page.getByTestId('modal-overlay')).toBeVisible();
// For disappearing elements
await page.getByTestId('close-modal').click();
await page.getByTestId('modal-overlay').waitFor({ state: 'detached', timeout: 5000 });
```

## Form Interaction Patterns

```ts
// fill() clears and types
await page.getByTestId('email-input').fill('user@example.com');

// For inputs with custom onChange that need keystrokes
await page.getByTestId('search-input').pressSequentially('search term', { delay: 50 });

// Switch components
const toggle = page.getByTestId('notifications-toggle');
await toggle.click();
await expect(toggle).toHaveAttribute('aria-checked', 'true');
```

## testID Naming Convention

Format: `{screen}-{element}-{qualifier}`

Examples:
- `login-email-input`
- `settings-save-button`
- `todo-item-{id}` (dynamic IDs for list items)
- `profile-avatar-image`
- `home-loading-spinner`
- `signup-password-error`

When adding testIDs to components, always add them to:
- Every screen's root `<View>`
- All buttons and pressable elements
- All text inputs
- Error messages and validation text
- Loading indicators
- List containers and list items (use dynamic IDs for items)

## Test File Structure

```ts
import { test, expect } from '@playwright/test';

test.describe('Feature: User Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-screen').waitFor({ state: 'visible' });
  });

  test('shows validation errors for empty form', async ({ page }) => {
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('email-error')).toBeVisible();
    await expect(page.getByTestId('email-error')).toHaveText(/required/i);
  });

  test('successfully logs in with valid credentials', async ({ page }) => {
    await page.getByTestId('email-input').fill('test@example.com');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('submit-button').click();
    await page.getByTestId('home-screen').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page).toHaveURL(/\/home/);
  });
});
```

## Playwright Config for RNW

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    command: 'npx expo start --web --port 8081',
    port: 8081,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

## Common Recipes

### FlatList / ScrollView
```ts
const list = page.getByTestId('todo-list');
await list.waitFor({ state: 'visible' });
const items = list.getByTestId(/^todo-item-/);
await expect(items).toHaveCount(5);
await list.getByTestId('todo-item-3').getByRole('button', { name: 'Delete' }).click();
await expect(items).toHaveCount(4);
```

### Modals
```ts
await page.getByTestId('open-modal-button').click();
const modal = page.getByTestId('confirmation-modal');
await modal.waitFor({ state: 'visible' });
await modal.getByTestId('confirm-button').click();
await modal.waitFor({ state: 'detached' });
```

### Toasts
```ts
await page.getByTestId('save-button').click();
const toast = page.getByTestId('toast-message');
await toast.waitFor({ state: 'visible', timeout: 5000 });
await expect(toast).toContainText(/saved/i);
await toast.waitFor({ state: 'hidden', timeout: 8000 });
```

### Auth State Reuse
```ts
// auth.setup.ts
import { test as setup, expect } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email-input').fill('test@example.com');
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('home-screen').waitFor({ state: 'visible' });
  await page.context().storageState({ path: './e2e/.auth/user.json' });
});
```

## Debugging Flaky Tests

```ts
// Pause and inspect interactively
await page.pause();

// Screenshot at a specific point
await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });

// Log actual DOM structure
const html = await page.getByTestId('problem-area').innerHTML();
console.log(html);

// Check if element exists but is hidden (common with RNW transforms/opacity)
const el = page.getByTestId('maybe-hidden');
console.log('visible:', await el.isVisible());
console.log('count:', await el.count());
```
