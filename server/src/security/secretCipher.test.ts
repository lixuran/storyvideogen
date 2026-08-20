import assert from "node:assert/strict";
import test from "node:test";

import {SecretCipher} from "./secretCipher.js";

test("provider secrets authenticate ciphertext and key version", () => {
  const first = new SecretCipher(Buffer.alloc(32, 1).toString("base64"), "v1");
  const encrypted = first.encrypt("synthetic-provider-key");
  assert.equal(first.decrypt(encrypted), "synthetic-provider-key");

  const tampered = {...encrypted, ciphertext: Buffer.from(encrypted.ciphertext)};
  tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;
  assert.throws(() => first.decrypt(tampered), /could not be decrypted/i);

  const wrongVersion = new SecretCipher(Buffer.alloc(32, 1).toString("base64"), "v2");
  assert.throws(() => wrongVersion.decrypt(encrypted), /key version/i);
  assert.throws(() => new SecretCipher("not-a-key", "v1"), /32-byte key/i);
});
