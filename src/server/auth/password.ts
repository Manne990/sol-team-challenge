import argon2 from "argon2";

const options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// A fixed dummy hash keeps unknown-account and wrong-password paths comparable.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$bm9ydGhzdGFyLWR1bW15LXNhbHQ$uYc4KqPYzUZ3Y3r8WgV2vA";

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash ?? DUMMY_HASH, password, options);
  } catch {
    return false;
  }
}
