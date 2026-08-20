import {pbkdf2Sync, randomBytes, timingSafeEqual} from "node:crypto";

const algorithm = "sha256";
const iterations = 200_000;
const keyLength = 32;

export function hashPassword(password: string): string {
  validatePassword(password);
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, iterations, keyLength, algorithm);
  return `pbkdf2_sha256$${iterations}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const [scheme, rounds, saltValue, digestValue, extra] = encoded.split("$");
    if (scheme !== "pbkdf2_sha256" || rounds !== String(iterations) || !saltValue || !digestValue || extra !== undefined) return false;
    const expected = Buffer.from(digestValue, "base64");
    const actual = pbkdf2Sync(password, Buffer.from(saltValue, "base64"), iterations, expected.length, algorithm);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 8 || password.length > 1024) {
    throw new Error("Password must be between 8 and 1024 characters.");
  }
}
