/**
 * Password hashing. Uses Bun's built-in bcrypt at cost 12.
 *
 * The password policy is enforced at the schema layer (see
 * `@finehance/shared/schemas/auth.ts`); this module only implements the
 * primitives. We deliberately keep verification timing-safe by always
 * running the hash compare even when the user is unknown — that's why the
 * "user not found" path also calls `verify` against a sentinel hash.
 */

const COST = 12;

const SENTINEL_HASH =
  '$2b$12$AVl05vbI0LBNSP5z6.Fg9ulrhlJ7qHr2L14oR7v9tPEnjA1JSgKTW'; // bcrypt of a random string

export async function hashPassword(plain: string): Promise<string> {
  return await Bun.password.hash(plain, { algorithm: 'bcrypt', cost: COST });
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  // Always do the work, even when there's no hash, to avoid leaking
  // existence by timing. `Bun.password.verify` rejects on a malformed hash,
  // hence the catch.
  try {
    return await Bun.password.verify(plain, hash ?? SENTINEL_HASH);
  } catch {
    return false;
  }
}
