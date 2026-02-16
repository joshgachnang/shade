# Test Cases: Logout

**Screen(s):** ProfileScreen, LoginScreen
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/(tabs)/profile.tsx

## Prerequisites
- App is running on web (localhost:8082)
- User is authenticated and on the Home screen
- A valid test account exists: test@example.com / password123

---

## TC-001: User successfully logs out from profile screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is logged in and on the Home screen.

**Steps:**
1. Tap the "Profile" tab in the bottom navigation bar
2. Wait for the Profile screen to load
3. Verify that the user's name and email are displayed
4. Tap the "Logout" button

**Expected Result:**
- After step 2: Profile screen shows the user's name and email address.
- After step 4: User is redirected to the Login screen. The heading "Welcome Back" is visible. The email and password fields are empty.

---

## TC-002: Profile shows loading state while fetching data

**Priority:** P1
**Type:** Loading State
**Automation:** [manual-only: requires slow network or intercept to observe loading state]

**Precondition:** User is logged in and navigating to the Profile tab.

**Steps:**
1. Tap the "Profile" tab
2. Observe the screen before profile data loads

**Expected Result:**
- A "Loading..." text is displayed while the profile data is being fetched. Once loaded, it is replaced by the user's name and email.

---

## TC-003: Profile displays "Not set" for missing user data

**Priority:** P1
**Type:** Empty State
**Automation:** [manual-only: requires a user account with missing name/email fields]

**Precondition:** User is logged in with an account that has no name set.

**Steps:**
1. Navigate to the Profile tab
2. Observe the Name and Email fields

**Expected Result:**
- Fields without data show "Not set" as the value instead of being blank or crashing.

---

## TC-004: User remains logged out after logout and page refresh

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires page refresh verification]

**Precondition:** User has just logged out and is on the Login screen.

**Steps:**
1. After logging out, refresh the browser page
2. Observe which screen appears

**Expected Result:**
- The Login screen appears. The user is not automatically re-authenticated. Auth tokens have been cleared.
