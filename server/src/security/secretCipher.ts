import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

import {ApiError} from "../http/errors.js";

export interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyId: string;
}

export class SecretCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string, readonly keyId: string) {
    this.key = Buffer.from(encodedKey, "base64");
    if (this.key.length !== 32) throw new Error("STORYVIDEOGEN_SECRET_MASTER_KEY must be a base64-encoded 32-byte key.");
    if (!keyId) throw new Error("STORYVIDEOGEN_SECRET_KEY_ID must not be empty.");
  }

  encrypt(value: string): EncryptedSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {ciphertext, nonce, authTag: cipher.getAuthTag(), keyId: this.keyId};
  }

  decrypt(secret: EncryptedSecret): string {
    if (secret.keyId !== this.keyId) throw new ApiError(503, "SECRET_KEY_UNAVAILABLE", "The configured encryption key version is unavailable.");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, secret.nonce);
      decipher.setAuthTag(secret.authTag);
      return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new ApiError(503, "SECRET_DECRYPTION_FAILED", "The provider credential could not be decrypted.");
    }
  }
}
