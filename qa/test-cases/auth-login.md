# Test Cases: Login

**Screen(s):** LoginScreen
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/login.tsx

## Prerequisites
- App is running on web (localhost:8082)
- A test account exists: test@example.com / password123
- User is not authenticated (logged out)

---

## TC-001: User successfully logs in with valid credentials

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the login screen. Mode is "Login" (default).

**Steps:**
1. Tap the "Email" text field and type "test@example.com"
2. Tap the "Password" text field and type "password123"
3. Tap the "Login" button

**Expected Result:**
- After step 2: The "Login" button becomes enabled.
- After step 3: User is redirected to the Home screen. The heading "Welcome to Shade" is visible.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Email | test@example.com | Valid existing account |
| Password | password123 | Correct password |

---

## TC-002: Login fails with invalid credentials

**Priority:** P0
**Type:** Error Handling
**Automation:** [automated]

**Precondition:** User is on the login screen.

**Steps:**
1. Tap the "Email" field and type "wrong@example.com"
2. Tap the "Password" field and type "wrongpassword"
3. Tap the "Login" button

**Expected Result:**
- After step 3: A red error message appears below the password field. The user remains on the login screen. The form fields retain their values.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Email | wrong@example.com | Non-existent account |
| Password | wrongpassword | Incorrect password |

---

## TC-003: Submit button is disabled when fields are empty

**Priority:** P0
**Type:** Validation / Error
**Automation:** [automated]

**Precondition:** User is on the login screen. No fields have been filled.

**Steps:**
1. Observe the "Login" button without filling any fields

**Expected Result:**
- The "Login" button is disabled (not tappable, visually muted).

---

## TC-004: Submit button is disabled when only email is filled

**Priority:** P1
**Type:** Validation / Error
**Automation:** [automated]

**Precondition:** User is on the login screen.

**Steps:**
1. Tap the "Email" field and type "test@example.com"
2. Leave the "Password" field empty
3. Observe the "Login" button

**Expected Result:**
- The "Login" button remains disabled.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Email | test@example.com | Valid format |
| Password | (empty) | Not filled |

---

## TC-005: Submit button is disabled when only password is filled

**Priority:** P1
**Type:** Validation / Error
**Automation:** [manual-only: mirrors TC-004 logic, low automation value]

**Precondition:** User is on the login screen.

**Steps:**
1. Leave the "Email" field empty
2. Tap the "Password" field and type "password123"
3. Observe the "Login" button

**Expected Result:**
- The "Login" button remains disabled.

---

## TC-006: User can toggle between Login and Sign Up modes

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the login screen in Login mode (default).

**Steps:**
1. Tap the "Need an account? Sign Up" button
2. Observe the screen changes
3. Tap the "Already have an account? Login" button
4. Observe the screen changes

**Expected Result:**
- After step 1: Heading changes to "Create Account". A "Name" field appears above the Email field. Toggle button text changes to "Already have an account? Login". Submit button text changes to "Sign Up".
- After step 3: Heading changes back to "Welcome Back". The "Name" field disappears. Toggle button text changes to "Need an account? Sign Up". Submit button text changes to "Login".

---

## TC-007: Login with extremely long email

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: boundary behavior depends on backend validation]

**Precondition:** User is on the login screen.

**Steps:**
1. Type a 300-character email address in the "Email" field
2. Type "password123" in the "Password" field
3. Tap "Login"

**Expected Result:**
- The app does not crash. An error message appears (either client-side validation or a server error). The user remains on the login screen.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Email | a{295}@b.com | 300 chars total |
| Password | password123 | Valid format |

---

## TC-008: Double-tap on submit button does not send duplicate requests

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: requires network inspection to verify single request]

**Precondition:** User is on the login screen with valid credentials filled in.

**Steps:**
1. Fill in valid email and password
2. Rapidly tap the "Login" button twice

**Expected Result:**
- After the first tap, the button enters a loading state (disabled with spinner). The second tap has no effect. User is logged in once and redirected to Home.
