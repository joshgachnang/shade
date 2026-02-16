# Test Cases: Tab Navigation

**Screen(s):** HomeScreen, ProfileScreen, TabLayout
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/(tabs)/_layout.tsx, frontend/app/(tabs)/index.tsx, frontend/app/(tabs)/profile.tsx

## Prerequisites
- App is running on web (localhost:8082)
- User is authenticated and on the Home screen

---

## TC-001: User can switch from Home to Profile tab

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is logged in and viewing the Home screen.

**Steps:**
1. Observe the bottom tab bar
2. Tap the "Profile" tab

**Expected Result:**
- After step 1: Two tabs are visible — "Home" (active/highlighted) and "Profile".
- After step 2: Profile screen loads showing the user's name and email. The "Profile" tab is now active/highlighted.

---

## TC-002: User can switch from Profile back to Home tab

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is logged in and viewing the Profile screen.

**Steps:**
1. Tap the "Home" tab

**Expected Result:**
- Home screen loads showing "Welcome to Shade". The "Home" tab is now active/highlighted.

---

## TC-003: Active tab is visually highlighted

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: visual styling verification is unreliable in automated tests]

**Precondition:** User is logged in and on the Home screen.

**Steps:**
1. Observe the Home tab icon color
2. Tap the "Profile" tab
3. Observe the Profile tab icon color and the Home tab icon color

**Expected Result:**
- After step 1: Home tab icon uses the primary/tint color (#0E9DCD).
- After step 3: Profile tab icon uses the tint color. Home tab icon uses the inactive/gray color.

---

## TC-004: Tab state does not persist incorrectly after logout and re-login

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: requires full logout/login cycle with tab state observation]

**Precondition:** User is logged in and on the Profile tab.

**Steps:**
1. Tap the "Logout" button on the Profile screen
2. Log back in with valid credentials
3. Observe which tab is active

**Expected Result:**
- After step 2: User lands on the Home screen with the Home tab active (not the Profile tab from the previous session).
