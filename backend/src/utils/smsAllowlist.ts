/**
 * Matching for the iMessage/SMS reply allowlist (AppConfig.imessage.replyAllowlist).
 *
 * Handles come in two shapes: phone numbers (in whatever format Messages or an
 * operator typed them) and iMessage email addresses. Phone numbers are compared
 * on digits only, and a bare 10-digit US number matches its +1-prefixed form so
 * "+19102755241" and "910-275-5241" are the same person.
 */

/** Lowercase emails; strip everything but digits from phone-like handles. */
export const normalizeHandle = (handle: string): string => {
  const trimmed = handle.trim().toLowerCase();
  if (trimmed.includes("@")) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits.length > 0 ? digits : trimmed;
};

const phonesMatch = (a: string, b: string): boolean => {
  if (a === b) {
    return true;
  }

  // Country-code tolerance: an 11+ digit number matches a shorter one when it
  // ends with it (e.g. "19102755241" vs "9102755241"), as long as the shorter
  // side is a full local number and not a fragment.
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  return shorter.length >= 10 && longer.endsWith(shorter);
};

export const isHandleAllowed = (handle: string | undefined, allowlist: string[]): boolean => {
  if (!handle) {
    return false;
  }

  const normalized = normalizeHandle(handle);
  if (normalized.length === 0) {
    return false;
  }

  return allowlist.some((entry) => {
    const normalizedEntry = normalizeHandle(entry);
    if (normalizedEntry.length === 0) {
      return false;
    }
    if (normalized.includes("@") || normalizedEntry.includes("@")) {
      return normalized === normalizedEntry;
    }
    return phonesMatch(normalized, normalizedEntry);
  });
};
