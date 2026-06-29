/**
 * Page expiration (TTL) logic.
 *
 * Pages never expire by default. Expiration is opt-in at three levels, most
 * specific wins: per-page (frontmatter / `<meta>` / CLI flag) → per-namespace
 * (server config) → global default (server config). When expiration is turned
 * on but no duration is given, {@link DEFAULT_EXPIRATION_DAYS} is used.
 *
 * An `ExpirationSetting` describes intent ("expire", "expire in 7d", "never").
 * It is resolved to a duration in milliseconds at publish time, then turned
 * into an absolute `expiresAt` timestamp that is stored with the page.
 */

/** Default lifetime applied when expiration is enabled without an explicit duration. */
export const DEFAULT_EXPIRATION_DAYS = 14;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = MS_PER_MINUTE * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const MS_PER_WEEK = MS_PER_DAY * 7;

export const DEFAULT_EXPIRATION_MS = DEFAULT_EXPIRATION_DAYS * MS_PER_DAY;

/**
 * A per-level expiration choice:
 * - `undefined` — not set at this level (fall through to the next).
 * - `false` / "never" — explicitly never expire (overrides less specific levels).
 * - `true` / "true" — expire using the default duration.
 * - a duration string (e.g. "7d", "12h", "30m", "2w") or a number of days.
 */
export type ExpirationSetting = boolean | number | string | undefined;

const DURATION_PATTERN =
  /^(\d+(?:\.\d+)?)\s*(w|d|h|m|min|day|days|week|weeks|hour|hours|minute|minutes)?$/;

const NEVER_TOKENS = new Set(["never", "false", "no", "off", "none", ""]);
const DEFAULT_TOKENS = new Set(["true", "yes", "on", "default"]);

export class InvalidExpirationError extends Error {
  constructor(value: string) {
    super(
      `Invalid expiration "${value}". Use a duration like "14d", "12h", "30m", "2w", true, or never.`,
    );
  }
}

/**
 * Parses a duration string to milliseconds. Accepts an optional unit
 * (`w`/`d`/`h`/`m`); a bare number is interpreted as days. Throws
 * {@link InvalidExpirationError} for anything unparseable or non-positive.
 */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim().toLowerCase());

  if (match === null) {
    throw new InvalidExpirationError(value);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "d";

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new InvalidExpirationError(value);
  }

  return amount * unitToMs(unit);
}

function unitToMs(unit: string): number {
  if (unit.startsWith("w")) {
    return MS_PER_WEEK;
  }

  if (unit.startsWith("d")) {
    return MS_PER_DAY;
  }

  if (unit.startsWith("h")) {
    return MS_PER_HOUR;
  }

  return MS_PER_MINUTE;
}

/**
 * Resolves a single expiration setting to a duration in milliseconds, or
 * `null` for "never". Throws {@link InvalidExpirationError} for malformed
 * duration strings or non-positive numbers.
 */
export function resolveExpirationMs(setting: ExpirationSetting): number | null {
  if (setting === undefined || setting === false) {
    return null;
  }

  if (setting === true) {
    return DEFAULT_EXPIRATION_MS;
  }

  if (typeof setting === "number") {
    if (!Number.isFinite(setting) || setting <= 0) {
      throw new InvalidExpirationError(String(setting));
    }

    return setting * MS_PER_DAY;
  }

  const token = setting.trim().toLowerCase();

  if (NEVER_TOKENS.has(token)) {
    return null;
  }

  if (DEFAULT_TOKENS.has(token)) {
    return DEFAULT_EXPIRATION_MS;
  }

  return parseDuration(token);
}

/**
 * Returns the first setting that was actually provided, letting more specific
 * levels (page) override less specific ones (namespace, global default).
 */
export function coalesceExpiration(
  ...settings: ExpirationSetting[]
): ExpirationSetting {
  for (const setting of settings) {
    if (setting !== undefined) {
      return setting;
    }
  }

  return undefined;
}

/** Converts a resolved duration to an absolute ISO timestamp, or `null`. */
export function expiresAtFrom(
  expirationMs: number | null,
  nowMs: number,
): string | null {
  if (expirationMs === null) {
    return null;
  }

  return new Date(nowMs + expirationMs).toISOString();
}

/** True when `expiresAt` is set and at or before `nowMs`. */
export function isExpired(
  expiresAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (expiresAt === null || expiresAt === undefined) {
    return false;
  }

  const expiryMs = Date.parse(expiresAt);

  return !Number.isNaN(expiryMs) && expiryMs <= nowMs;
}
