# Test Cases: Auth Routing

**Screen(s):** RootLayout, LoginScreen, HomeScreen
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/_layout.tsx

## Prerequisites
- App is running on web (localhost:8082)
- A valid test account exists: test@example.com / password123

---

## TC-001: Unauthenticated user is shown the login screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** No auth tokens are stored (fresh browser or cleared storage).

**Steps:**
1. Navigate to the app root URL (http://localhost:8082)

**Expected Result:**
- The Login screen is displayed with the heading "Welcome Back". The Home and Profile tabs are not visible.

---

## TC-002: Authenticated user bypasses login and sees the Home screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User has valid auth tokens stored (previously logged in).

**Steps:**
1. Navigate to the app root URL (http://localhost:8082)

**Expected Result:**
- The Home screen is displayed with the heading "Welcome to Shade". The bottom tab bar is visible with Home and Profile tabs. The Login screen is not shown.

---

## TC-003: Unauthenticated user cannot access tab screens directly

**Priority:** P1
**Type:** Error Handling
**Automation:** [manual-only: Expo Router handles this internally, difficult to force URL navigation in E2E]

**Precondition:** No auth tokens are stored.

**Steps:**
1. Navigate directly to a tab route URL (e.g., http://localhost:8082/profile)

**Expected Result:**
- The Login screen is shown instead of the Profile screen. The user cannot access authenticated routes without logging in.

---

## TC-004: Auth state persists across page refresh

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires page refresh]

**Precondition:** User is logged in and on the Home screen.

**Steps:**
1. Refresh the browser page (F5 or Cmd+R)
2. Wait for the app to reload

**Expected Result:**
- The Home screen reappears after reload. The user is still authenticated. The Login screen does not flash briefly during load.
