import type {SqliteDatabase} from "../database.js";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "suspended";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  csrfTokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export class IdentityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  findUserByUsername(username: string): UserRecord | undefined {
    const row = this.database.prepare("SELECT id, username, password_hash, role, status, created_at FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | undefined;
    return row && mapUser(row);
  }

  findUserById(id: string): UserRecord | undefined {
    const row = this.database.prepare("SELECT id, username, password_hash, role, status, created_at FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row && mapUser(row);
  }

  createUser(id: string, username: string, passwordHash: string, now: string): UserRecord {
    this.database.prepare("INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, 'user', 'active', ?, ?)").run(id, username, passwordHash, now, now);
    return this.findUserById(id)!;
  }

  updatePassword(userId: string, passwordHash: string, now: string): void {
    this.database.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, now, userId);
  }

  createSession(id: string, userId: string, tokenHash: string, csrfTokenHash: string, now: string, expiresAt: string): void {
    this.database.prepare("INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, tokenHash, csrfTokenHash, now, now, expiresAt);
  }

  findSession(tokenHash: string): SessionRecord | undefined {
    const row = this.database.prepare("SELECT id, user_id, csrf_token_hash, expires_at, revoked_at FROM sessions WHERE token_hash = ?").get(tokenHash) as SessionRow | undefined;
    return row && {id: row.id, userId: row.user_id, csrfTokenHash: row.csrf_token_hash, expiresAt: row.expires_at, revokedAt: row.revoked_at};
  }

  touchSession(id: string, now: string): void {
    this.database.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, id);
  }

  revokeSession(id: string, now: string): void {
    this.database.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(now, id);
  }

  revokeUserSessions(userId: string, now: string): void {
    this.database.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").run(now, userId);
  }

  listUsers(): Array<Pick<UserRecord, "id" | "username" | "role" | "status" | "createdAt">> {
    const rows = this.database.prepare("SELECT id, username, password_hash, role, status, created_at FROM users ORDER BY created_at DESC").all() as UserRow[];
    return rows.map(({id, username, role, status, created_at}) => ({id, username, role, status, createdAt: created_at}));
  }

  promoteToAdmin(username: string, now: string): "updated" | "already-admin" | "not-found" {
    const user = this.findUserByUsername(username);
    if (!user) return "not-found";
    if (user.role === "admin") return "already-admin";
    this.database.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(now, user.id);
    return "updated";
  }
}

function mapUser(row: UserRow): UserRecord {
  return {id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, status: row.status, createdAt: row.created_at};
}
