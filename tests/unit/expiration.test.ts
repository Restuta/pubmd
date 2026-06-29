import { describe, expect, it } from "vitest";

import {
  coalesceExpiration,
  DEFAULT_EXPIRATION_MS,
  expiresAtFrom,
  InvalidExpirationError,
  isExpired,
  parseDuration,
  resolveExpirationMs,
} from "../../src/core/expiration.js";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const MS_PER_WEEK = MS_PER_DAY * 7;

describe("parseDuration", () => {
  it("parses days, hours, minutes, and weeks", () => {
    expect(parseDuration("7d")).toBe(7 * MS_PER_DAY);
    expect(parseDuration("12h")).toBe(12 * MS_PER_HOUR);
    expect(parseDuration("30m")).toBe(30 * MS_PER_MINUTE);
    expect(parseDuration("2w")).toBe(2 * MS_PER_WEEK);
  });

  it("treats a bare number as days and tolerates spacing/case", () => {
    expect(parseDuration("3")).toBe(3 * MS_PER_DAY);
    expect(parseDuration("  5 D ")).toBe(5 * MS_PER_DAY);
  });

  it("accepts long-form units", () => {
    expect(parseDuration("2 days")).toBe(2 * MS_PER_DAY);
    expect(parseDuration("1 week")).toBe(MS_PER_WEEK);
  });

  it("rejects malformed or non-positive durations", () => {
    expect(() => parseDuration("soon")).toThrow(InvalidExpirationError);
    expect(() => parseDuration("0d")).toThrow(InvalidExpirationError);
    expect(() => parseDuration("-1d")).toThrow(InvalidExpirationError);
    expect(() => parseDuration("")).toThrow(InvalidExpirationError);
  });
});

describe("resolveExpirationMs", () => {
  it("returns null for never-like settings", () => {
    expect(resolveExpirationMs(undefined)).toBeNull();
    expect(resolveExpirationMs(false)).toBeNull();
    expect(resolveExpirationMs("never")).toBeNull();
    expect(resolveExpirationMs("false")).toBeNull();
    expect(resolveExpirationMs("")).toBeNull();
  });

  it("uses the default duration when enabled without a value", () => {
    expect(resolveExpirationMs(true)).toBe(DEFAULT_EXPIRATION_MS);
    expect(resolveExpirationMs("true")).toBe(DEFAULT_EXPIRATION_MS);
    expect(resolveExpirationMs("default")).toBe(DEFAULT_EXPIRATION_MS);
  });

  it("resolves numbers as days and strings as durations", () => {
    expect(resolveExpirationMs(3)).toBe(3 * MS_PER_DAY);
    expect(resolveExpirationMs("36h")).toBe(36 * MS_PER_HOUR);
  });

  it("throws on invalid durations and non-positive numbers", () => {
    expect(() => resolveExpirationMs("whenever")).toThrow(
      InvalidExpirationError,
    );
    expect(() => resolveExpirationMs(0)).toThrow(InvalidExpirationError);
  });
});

describe("coalesceExpiration", () => {
  it("returns the first defined setting (page beats namespace)", () => {
    expect(coalesceExpiration("7d", true)).toBe("7d");
    expect(coalesceExpiration(undefined, true)).toBe(true);
    expect(coalesceExpiration(undefined, undefined)).toBeUndefined();
  });

  it("treats false as defined so a page can opt out of a namespace policy", () => {
    expect(coalesceExpiration(false, true)).toBe(false);
  });
});

describe("expiresAtFrom / isExpired", () => {
  const now = Date.parse("2026-06-29T00:00:00.000Z");

  it("computes an absolute timestamp from a duration", () => {
    expect(expiresAtFrom(MS_PER_DAY, now)).toBe("2026-06-30T00:00:00.000Z");
    expect(expiresAtFrom(null, now)).toBeNull();
  });

  it("reports expiry only at or after the deadline", () => {
    const expiresAt = expiresAtFrom(MS_PER_DAY, now);
    expect(isExpired(expiresAt, now)).toBe(false);
    expect(isExpired(expiresAt, now + MS_PER_DAY - 1)).toBe(false);
    expect(isExpired(expiresAt, now + MS_PER_DAY)).toBe(true);
  });

  it("never expires when expiresAt is null/undefined or unparseable", () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
    expect(isExpired("not-a-date", now)).toBe(false);
  });
});
