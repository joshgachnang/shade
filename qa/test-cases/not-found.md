# Test Cases: Not Found Screen

**Screen(s):** NotFoundScreen
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/+not-found.tsx

## Prerequisites
- App is running on web (localhost:8082)

---

## TC-001: Invalid route shows the Not Found screen

**Priority:** P2
**Type:** Error Handling
**Automation:** [automated]

**Precondition:** User is on any screen (authenticated or not).

**Steps:**
1. Navigate to a non-existent route (e.g., http://localhost:8082/this-does-not-exist)

**Expected Result:**
- The Not Found screen is displayed with the text "This screen doesn't exist." and a "Go to home screen" link. The page title shows "Oops!".

---

## TC-002: "Go to home screen" link navigates to the correct screen

**Priority:** P2
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the Not Found screen.

**Steps:**
1. Tap the "Go to home screen" link

**Expected Result:**
- If authenticated: User is navigated to the Home screen with "Welcome to Shade" heading.
- If not authenticated: User is navigated to the Login screen.

---

## TC-003: Not Found screen does not crash with deeply nested invalid routes

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: Expo Router behavior with deep paths may vary]

**Precondition:** None.

**Steps:**
1. Navigate to a deeply nested invalid route (e.g., http://localhost:8082/a/b/c/d/e/f)

**Expected Result:**
- The Not Found screen is displayed. The app does not crash or show a blank white screen.
