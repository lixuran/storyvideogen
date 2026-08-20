import {randomUUID, timingSafeEqual} from "node:crypto";

import type {IdentityRepository, UserRecord, UserRole} from "../db/repositories/identityRepository.js";
import {ApiError} from "../http/errors.js";
import {hashPassword, validatePassword, verifyPassword} from "../security/passwords.js";
import {hashToken, randomToken} from "../security/tokens.js";

const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,39}$/;
const dummyPasswordHash = hashPassword("storyvideogen-dummy-password");

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface AuthenticatedSession {
  user: PublicUser;
  sessionId: string;
  csrfTokenHash: string;
}

export interface IssuedSession {
  user: PublicUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

export class AuthService {
  constructor(private readonly repository: IdentityRepository, private readonly ttlSeconds: number) {}

  register(usernameValue: unknown, passwordValue: unknown): IssuedSession {
    const username = normalizeUsername(usernameValue);
    const password = requirePassword(passwordValue);
    if (this.repository.findUserByUsername(username)) throw new ApiError(409, "USERNAME_UNAVAILABLE", "That username is unavailable.");
    const now = new Date().toISOString();
    let user: UserRecord;
    try {
      user = this.repository.createUser(randomUUID(), username, hashPassword(password), now);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, "USERNAME_UNAVAILABLE", "That username is unavailable.");
      throw error;
    }
    return this.issueSession(user, now);
  }

  login(usernameValue: unknown, passwordValue: unknown): IssuedSession {
    const username = typeof usernameValue === "string" ? usernameValue.trim().toLowerCase() : "";
    const password = typeof passwordValue === "string" ? passwordValue : "";
    const user = username ? this.repository.findUserByUsername(username) : undefined;
    const passwordMatches = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
    if (!user || user.status !== "active" || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }
    return this.issueSession(user, new Date().toISOString());
  }

  authenticate(rawToken: string | undefined): AuthenticatedSession {
    if (!rawToken) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    const session = this.repository.findSession(hashToken(rawToken));
    const now = new Date().toISOString();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    }
    const user = this.repository.findUserById(session.userId);
    if (!user || user.status !== "active") {
      this.repository.revokeSession(session.id, now);
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    }
    this.repository.touchSession(session.id, now);
    return {user: publicUser(user), sessionId: session.id, csrfTokenHash: session.csrfTokenHash};
  }

  verifyCsrf(session: AuthenticatedSession, csrfToken: string | undefined): void {
    const actual = csrfToken ? Buffer.from(hashToken(csrfToken), "hex") : Buffer.alloc(0);
    const expected = Buffer.from(session.csrfTokenHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ApiError(403, "CSRF_INVALID", "The security token is missing or invalid.");
    }
  }

  logout(session: AuthenticatedSession): void {
    this.repository.revokeSession(session.sessionId, new Date().toISOString());
  }

  changePassword(session: AuthenticatedSession, currentValue: unknown, nextValue: unknown): void {
    const currentPassword = typeof currentValue === "string" ? currentValue : "";
    const nextPassword = requirePassword(nextValue);
    const user = this.repository.findUserById(session.user.id);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new ApiError(400, "CURRENT_PASSWORD_INVALID", "The current password is incorrect.");
    }
    const now = new Date().toISOString();
    this.repository.updatePassword(user.id, hashPassword(nextPassword), now);
    this.repository.revokeUserSessions(user.id, now);
  }

  private issueSession(user: UserRecord, now: string): IssuedSession {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.parse(now) + this.ttlSeconds * 1000).toISOString();
    this.repository.createSession(randomUUID(), user.id, hashToken(sessionToken), hashToken(csrfToken), now, expiresAt);
    return {user: publicUser(user), sessionToken, csrfToken, expiresAt};
  }
}

function normalizeUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!usernamePattern.test(username)) {
    throw new ApiError(400, "USERNAME_INVALID", "Username must be 3-40 characters using letters, numbers, dots, hyphens, or underscores.");
  }
  return username;
}

function requirePassword(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  try {
    validatePassword(password);
  } catch (error) {
    throw new ApiError(400, "PASSWORD_INVALID", (error as Error).message);
  }
  return password;
}

function publicUser(user: UserRecord): PublicUser {
  return {id: user.id, username: user.username, role: user.role};
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
