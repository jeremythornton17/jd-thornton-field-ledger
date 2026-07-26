// Small, dependency-free validation helpers for the inventory API.
// Kept in plain JS (no TypeScript) so they can be unit tested directly with
// `node --test`, without needing a build step first.

export const TEXT_LIMITS = {
  species: 120,
  height: 40,
  caliper: 40,
  client: 160,
  orderNumber: 60,
  markingMethod: 160,
  details: 2000,
  performedBy: 120,
  activityType: 60,
};

/** True for finite whole numbers greater than zero (rejects 0, negatives, NaN, strings). */
export function isPositiveInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/** True for non-empty (after trimming) strings. */
export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp);
}

/** Trims a string and truncates it to maxLength; returns "" for anything else. */
export function clampText(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}
