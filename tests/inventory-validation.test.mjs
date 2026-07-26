import assert from "node:assert/strict";
import test from "node:test";
import {
  clampText,
  isNonEmptyString,
  isPositiveInteger,
  isValidDate,
  TEXT_LIMITS,
} from "../app/api/inventory/validation.mjs";

test("isPositiveInteger accepts only positive whole numbers", () => {
  assert.equal(isPositiveInteger(1), true);
  assert.equal(isPositiveInteger(86), true);
  assert.equal(isPositiveInteger(0), false);
  assert.equal(isPositiveInteger(-5), false);
  assert.equal(isPositiveInteger(2.5), false);
  assert.equal(isPositiveInteger(NaN), false);
  assert.equal(isPositiveInteger(Infinity), false);
  assert.equal(isPositiveInteger("5"), false);
  assert.equal(isPositiveInteger(null), false);
  assert.equal(isPositiveInteger(undefined), false);
});

test("isNonEmptyString rejects blank and non-string values", () => {
  assert.equal(isNonEmptyString("Live Oak"), true);
  assert.equal(isNonEmptyString("  Live Oak  "), true);
  assert.equal(isNonEmptyString(""), false);
  assert.equal(isNonEmptyString("   "), false);
  assert.equal(isNonEmptyString(undefined), false);
  assert.equal(isNonEmptyString(42), false);
});

test("isValidDate only accepts real calendar dates in YYYY-MM-DD form", () => {
  assert.equal(isValidDate("2024-02-12"), true);
  assert.equal(isValidDate("2024-13-40"), false);
  assert.equal(isValidDate("02/12/2024"), false);
  assert.equal(isValidDate(""), false);
  assert.equal(isValidDate(undefined), false);
});

test("clampText trims and truncates, and tolerates bad input", () => {
  assert.equal(clampText("  Live Oak  ", TEXT_LIMITS.species), "Live Oak");
  assert.equal(clampText("a".repeat(200), 10), "a".repeat(10));
  assert.equal(clampText(undefined, 10), "");
  assert.equal(clampText(42, 10), "");
});
