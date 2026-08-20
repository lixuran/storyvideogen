import {randomUUID} from "node:crypto";

import type {EncryptedSecret} from "../../security/secretCipher.js";
import type {SqliteDatabase} from "../database.js";

export type ProviderTestStatus = "untested" | "testing" | "available" | "unavailable";

export interface ProviderSecretRecord extends EncryptedSecret {
  id: string;
  scope: "user" | "platform";
  userId: string | null;
  provider: string;
  lastFour: string;
  status: "active" | "disabled" | "error";
  textTestStatus: ProviderTestStatus;
  imageTestStatus: ProviderTestStatus;
  lastTestedAt: string | null;
  updatedAt: string;
}

interface ProviderSecretRow {
  id: string;
  scope: "user" | "platform";
  user_id: string | null;
  provider: string;
  encrypted_value: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  encryption_key_id: string;
  last_four: string;
  status: "active" | "disabled" | "error";
  text_test_status: ProviderTestStatus;
  image_test_status: ProviderTestStatus;
  last_tested_at: string | null;
  updated_at: string;
}

export class ProviderSecretRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listForUser(userId: string): ProviderSecretRecord[] {
    return (this.database.prepare("SELECT * FROM provider_secrets WHERE scope = 'user' AND user_id = ? ORDER BY provider").all(userId) as ProviderSecretRow[]).map(mapSecret);
  }

  findUserProvider(userId: string, provider: string): ProviderSecretRecord | undefined {
    const row = this.database.prepare("SELECT * FROM provider_secrets WHERE scope = 'user' AND user_id = ? AND provider = ?").get(userId, provider) as ProviderSecretRow | undefined;
    return row && mapSecret(row);
  }

  findPlatformProvider(provider: string): ProviderSecretRecord | undefined {
    const row = this.database.prepare("SELECT * FROM provider_secrets WHERE scope = 'platform' AND provider = ?").get(provider) as ProviderSecretRow | undefined;
    return row && mapSecret(row);
  }
  listPlatform(): ProviderSecretRecord[] { return (this.database.prepare("SELECT * FROM provider_secrets WHERE scope = 'platform' ORDER BY provider").all() as ProviderSecretRow[]).map(mapSecret); }
  savePlatformProvider(provider: string, secret: EncryptedSecret, lastFour: string, now: string): void { const result = this.database.prepare("UPDATE provider_secrets SET encrypted_value = ?, nonce = ?, auth_tag = ?, encryption_key_id = ?, last_four = ?, status = 'active', text_test_status = 'untested', image_test_status = 'untested', updated_at = ? WHERE scope = 'platform' AND provider = ?").run(secret.ciphertext, secret.nonce, secret.authTag, secret.keyId, lastFour, now, provider); if (!result.changes) this.database.prepare("INSERT INTO provider_secrets (id, scope, user_id, provider, encrypted_value, nonce, auth_tag, encryption_key_id, last_four, status, text_test_status, image_test_status, created_at, updated_at) VALUES (?, 'platform', NULL, ?, ?, ?, ?, ?, ?, 'active', 'untested', 'untested', ?, ?)").run(randomUUID(), provider, secret.ciphertext, secret.nonce, secret.authTag, secret.keyId, lastFour, now, now); }
  disablePlatform(provider: string, now: string): boolean { return this.database.prepare("UPDATE provider_secrets SET status = 'disabled', updated_at = ? WHERE scope = 'platform' AND provider = ?").run(now, provider).changes === 1; }

  saveUserProvider(userId: string, provider: string, secret: EncryptedSecret, lastFour: string, now: string): void {
    const result = this.database.prepare(`UPDATE provider_secrets SET encrypted_value = ?, nonce = ?, auth_tag = ?, encryption_key_id = ?, last_four = ?, status = 'active', text_test_status = 'untested', image_test_status = 'untested', last_tested_at = NULL, updated_at = ? WHERE scope = 'user' AND user_id = ? AND provider = ?`).run(secret.ciphertext, secret.nonce, secret.authTag, secret.keyId, lastFour, now, userId, provider);
    if (result.changes === 0) {
      this.database.prepare(`INSERT INTO provider_secrets (id, scope, user_id, provider, encrypted_value, nonce, auth_tag, encryption_key_id, last_four, status, text_test_status, image_test_status, created_at, updated_at) VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, 'active', 'untested', 'untested', ?, ?)`).run(randomUUID(), userId, provider, secret.ciphertext, secret.nonce, secret.authTag, secret.keyId, lastFour, now, now);
    }
  }

  deleteUserProvider(userId: string, provider: string): boolean {
    return this.database.prepare("DELETE FROM provider_secrets WHERE scope = 'user' AND user_id = ? AND provider = ?").run(userId, provider).changes > 0;
  }

  updateTestStatus(userId: string, provider: string, textStatus: ProviderTestStatus, imageStatus: ProviderTestStatus, now: string): void {
    this.database.prepare("UPDATE provider_secrets SET text_test_status = ?, image_test_status = ?, last_tested_at = ?, updated_at = ? WHERE scope = 'user' AND user_id = ? AND provider = ?").run(textStatus, imageStatus, now, now, userId, provider);
  }
}

function mapSecret(row: ProviderSecretRow): ProviderSecretRecord {
  return {
    id: row.id,
    scope: row.scope,
    userId: row.user_id,
    provider: row.provider,
    ciphertext: row.encrypted_value,
    nonce: row.nonce,
    authTag: row.auth_tag,
    keyId: row.encryption_key_id,
    lastFour: row.last_four,
    status: row.status,
    textTestStatus: row.text_test_status,
    imageTestStatus: row.image_test_status,
    lastTestedAt: row.last_tested_at,
    updatedAt: row.updated_at
  };
}
