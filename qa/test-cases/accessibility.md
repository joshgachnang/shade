# Test Cases: Accessibility

**Screen(s):** LoginScreen, ProfileScreen, HomeScreen
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/login.tsx, frontend/app/(tabs)/profile.tsx, frontend/app/(tabs)/index.tsx

## Prerequisites
- App is running on web (localhost:8082)
- Testing with a keyboard (no mouse/trackpad)

---

## TC-001: Login form is navigable by keyboard

**Priority:** P2
**Type:** Accessibility
**Automation:** [automated]

**Precondition:** User is on the Login screen. Focus is at the top of the page.

**Steps:**
1. Press Tab to move focus to the Email field
2. Type "test@example.com"
3. Press Tab to move focus to the Password field
4. Type "password123"
5. Press Tab to move focus to the Login button
6. Press Enter or Space to submit

**Expected Result:**
- After step 1: Email field has visible focus indicator (outline or border change).
- After step 3: Password field has visible focus indicator.
- After step 5: Login button has visible focus indicator.
- After step 6: Login is submitted. User is redirected to the Home screen.

---

## TC-002: Signup form name field is in the tab order

**Priority:** P2
**Type:** Accessibility
**Automation:** [manual-only: tab order depends on DOM render order which may vary]

**Precondition:** User is on the Login screen in Sign Up mode.

**Steps:**
1. Press Tab to move focus through the form fields
2. Observe the order of focused elements

**Expected Result:**
- Tab order is: Name → Email → Password → Sign Up button → Toggle button. No fields are skipped. Each field has a visible focus indicator.

---

## TC-003: Tab bar is navigable by keyboard

**Priority:** P2
**Type:** Accessibility
**Automation:** [manual-only: Expo Router tab bar keyboard behavior may vary]

**Precondition:** User is authenticated and on the Home screen.

**Steps:**
1. Press Tab repeatedly until focus reaches the tab bar
2. Use arrow keys or Tab to move between Home and Profile tabs
3. Press Enter or Space to activate the Profile tab

**Expected Result:**
- Tab bar items are focusable. The focused tab has a visible indicator. Activating a tab navigates to that screen.

---

## TC-004: Error messages are announced to screen readers

**Priority:** P2
**Type:** Accessibility
**Automation:** [manual-only: requires screen reader to verify announcements]

**Precondition:** User is on the Login screen with a screen reader active (VoiceOver on Mac, NVDA on Windows).

**Steps:**
1. Fill in invalid credentials
2. Tap or activate the Login button
3. Listen for screen reader output

**Expected Result:**
- The error message text is announced by the screen reader when it appears. The error element has appropriate ARIA attributes (e.g., role="alert" or aria-live="polite").
