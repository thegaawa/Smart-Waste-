/**
 * Phone number handling. Users may sign in with a phone number instead of an
 * email (Figure 4.1: "Email or phone"). Numbers are stored in E.164 form,
 * for example +2348031234567.
 */

const NIGERIA_COUNTRY_CODE = "234";

/** Nigerian mobile numbers: +234 followed by 10 digits starting with 7, 8 or 9. */
const NIGERIAN_E164 = /^\+234[789]\d{9}$/;

/** Any other international number in E.164 form (8 to 15 digits after "+"). */
const GENERIC_E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalise a phone number typed by a user into E.164.
 *
 * Accepted inputs (spaces, dashes, dots and brackets are ignored):
 *   "0803 123 4567"      -> "+2348031234567"
 *   "2348031234567"      -> "+2348031234567"
 *   "+234 803 123 4567"  -> "+2348031234567"
 *   "+447700900123"      -> "+447700900123"
 *
 * Returns null when the input is not a valid phone number.
 */
export function normalizePhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (cleaned.length === 0) return null;

  let candidate: string;
  if (cleaned.startsWith("+")) {
    candidate = cleaned;
  } else if (cleaned.startsWith("00")) {
    candidate = `+${cleaned.slice(2)}`;
  } else if (/^0[789]\d{9}$/.test(cleaned)) {
    // Local Nigerian format, e.g. 08031234567
    candidate = `+${NIGERIA_COUNTRY_CODE}${cleaned.slice(1)}`;
  } else if (/^234[789]\d{9}$/.test(cleaned)) {
    // Country code without the plus sign
    candidate = `+${cleaned}`;
  } else {
    return null;
  }

  if (!/^\+\d+$/.test(candidate)) return null;
  if (NIGERIAN_E164.test(candidate) || GENERIC_E164.test(candidate)) return candidate;
  return null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/** Very small email check; the server does the real validation. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(input: string): boolean {
  return EMAIL_PATTERN.test(input.trim());
}

/** Lower-case and trim an email address for storage and lookup. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Work out whether a login identifier is an email or a phone number.
 * Returns the normalised value or null when it is neither.
 */
export function classifyIdentifier(
  input: string,
): { kind: "email"; value: string } | { kind: "phone"; value: string } | null {
  const trimmed = input.trim();
  if (trimmed.includes("@")) {
    return isLikelyEmail(trimmed) ? { kind: "email", value: normalizeEmail(trimmed) } : null;
  }
  const phone = normalizePhone(trimmed);
  return phone ? { kind: "phone", value: phone } : null;
}
