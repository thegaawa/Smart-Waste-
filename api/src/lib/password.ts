import { compare, hash } from "bcryptjs";

import { env } from "../env.js";

/** Passwords are stored only as bcrypt hashes (Chapter 3.12). */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
