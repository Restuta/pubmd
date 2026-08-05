import { describe, expect, it } from "vitest";

import {
  hashPassword,
  pageUnlockToken,
  verifyPassword,
} from "../../src/core/hash.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("s3cret");

    expect(stored).not.toContain("s3cret");
    expect(await verifyPassword("s3cret", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("s3cret");

    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("produces a different salt per call", async () => {
    const first = await hashPassword("same");
    const second = await hashPassword("same");

    expect(first).not.toBe(second);
    expect(await verifyPassword("same", first)).toBe(true);
    expect(await verifyPassword("same", second)).toBe(true);
  });
});

describe("pageUnlockToken", () => {
  it("is stable for the same inputs", () => {
    expect(pageUnlockToken("page-1", "salt:hash")).toBe(
      pageUnlockToken("page-1", "salt:hash"),
    );
  });

  it("changes with the pageId and with the password hash", () => {
    const base = pageUnlockToken("page-1", "salt:hash");

    expect(pageUnlockToken("page-2", "salt:hash")).not.toBe(base);
    expect(pageUnlockToken("page-1", "salt:rotated")).not.toBe(base);
  });
});
