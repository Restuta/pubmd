import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt: (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer> = promisify(scryptCallback);

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Hash a page password for storage. Format: `{saltHex}:{scryptHex}` (scrypt defaults,
 * 32-byte key). Only the hash is stored — the plaintext password never is.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");

  if (saltHex === undefined || hashHex === undefined) {
    return false;
  }

  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), 32);
  return constantTimeEqual(derived.toString("hex"), hashHex);
}

/**
 * Value stored in the reader's unlock cookie. Deriving it requires the stored
 * passwordHash (which embeds a random salt), so knowing the password is not enough to
 * forge it — and rotating the password invalidates every outstanding cookie.
 */
export function pageUnlockToken(pageId: string, passwordHash: string): string {
  return sha256(`page-unlock:${pageId}:${passwordHash}`);
}

export function createToken(): string {
  return randomBytes(24).toString("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
