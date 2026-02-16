# Test Cases: Signup

**Screen(s):** LoginScreen (signup mode)
**Date:** 2026-02-15
**Author:** Claude
**Related Code:** frontend/app/login.tsx

## Prerequisites
- App is running on web (localhost:8082)
- User is not authenticated (logged out)
- User has navigated to signup mode by tapping "Need an account? Sign Up"

---

## TC-001: User successfully signs up with valid details

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is on the login screen in Sign Up mode.

**Steps:**
1. Tap the "Name" field and type "New User"
2. Tap the "Email" field and type a unique email (e.g., "newuser-{timestamp}@example.com")
3. Tap the "Password" field and type "newpassword123"
4. Tap the "Sign Up" button

**Expected Result:**
- After step 3: The "Sign Up" button becomes enabled (all three required fields are filled).
- After step 4: User is redirected to the Home screen. The heading "Welcome to Shade" is visible.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Name | New User | Non-empty string |
| Email | newuser-{timestamp}@example.com | Must be unique per test run |
| Password | newpassword123 | Meets minimum requirements |

---

## TC-002: Submit button is disabled when name is missing in signup mode

**Priority:** P0
**Type:** Validation / Error
**Automation:** [automated]

**Precondition:** User is on the login screen in Sign Up mode.

**Steps:**
1. Leave "Name" field empty
2. Tap "Email" and type "test@example.com"
3. Tap "Password" and type "password123"
4. Observe the "Sign Up" button

**Expected Result:**
- The "Sign Up" button remains disabled. All three fields (Name, Email, Password) are required in signup mode.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Name | (empty) | Missing required field |
| Email | test@example.com | Valid format |
| Password | password123 | Valid format |

---

## TC-003: Signup with an already-registered email

**Priority:** P0
**Type:** Error Handling
**Automation:** [manual-only: requires known pre-existing account in test environment]

**Precondition:** User is on the login screen in Sign Up mode. The email "test@example.com" is already registered.

**Steps:**
1. Type "Duplicate User" in the "Name" field
2. Type "test@example.com" in the "Email" field
3. Type "password123" in the "Password" field
4. Tap the "Sign Up" button

**Expected Result:**
- After step 4: A red error message appears below the password field indicating the account already exists. The user remains on the signup form.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Name | Duplicate User | Any non-empty string |
| Email | test@example.com | Already registered |
| Password | password123 | Valid format |

---

## TC-004: Form fields are disabled while signup request is loading

**Priority:** P1
**Type:** Loading State
**Automation:** [manual-only: requires slow network or intercept to observe loading state]

**Precondition:** User is on the login screen in Sign Up mode with all fields filled.

**Steps:**
1. Fill in Name, Email, and Password with valid values
2. Tap the "Sign Up" button
3. Immediately observe the form state before the response returns

**Expected Result:**
- All text fields (Name, Email, Password) are disabled during loading. The submit button shows a loading spinner and is not tappable. The toggle mode button is also disabled.

---

## TC-005: Signup with special characters in name

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: boundary behavior depends on backend]

**Precondition:** User is on the login screen in Sign Up mode.

**Steps:**
1. Type "José O'Brien-Smith III" in the "Name" field
2. Type a unique email in the "Email" field
3. Type "password123" in the "Password" field
4. Tap "Sign Up"

**Expected Result:**
- Signup succeeds. User is redirected to Home screen. The name with special characters is preserved.

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Name | José O'Brien-Smith III | Accents, apostrophe, hyphen |
| Email | special-{timestamp}@example.com | Unique per run |
| Password | password123 | Valid format |
