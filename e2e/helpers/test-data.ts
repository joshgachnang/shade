export const testUsers = {
  valid: {
    name: "Test User",
    email: "test@example.com",
    password: "password123",
  },
  signup: {
    name: "New User",
    email: `signup-${Date.now()}@example.com`,
    password: "newpassword123",
  },
  invalid: {
    email: "wrong@example.com",
    password: "wrongpassword",
  },
};
