import argon2 from "argon2";
import { scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);

const options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// A fixed dummy hash keeps unknown-account and wrong-password paths comparable.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$bm9ydGhzdGFyLWR1bW15LXNhbHQ$uYc4KqPYzUZ3Y3r8WgV2vA";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(
  hash: string | undefined,
  password: string,
): Promise<boolean> {
  try {
    if (hash?.startsWith("scrypt$")) {
      const [, salt, expectedHex] = hash.split("$");
      if (!salt || !expectedHex) return false;
      const expected = Buffer.from(expectedHex, "hex");
      const actual = (await scrypt(password, salt, expected.length)) as Buffer;
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    }
    return await argon2.verify(hash ?? DUMMY_HASH, password);
  } catch {
    return false;
  }
}
