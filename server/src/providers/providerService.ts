import type {ProviderSecretRecord, ProviderSecretRepository} from "../db/repositories/providerSecretRepository.js";
import {ApiError} from "../http/errors.js";
import type {SecretCipher} from "../security/secretCipher.js";

const providerDefinitions = [
  {id: "zhipu", label: "Zhipu AI", text: true, image: true, search: false},
  {id: "siliconflow", label: "SiliconFlow", text: false, image: true, search: false},
  {id: "pexels", label: "Pexels", text: false, image: false, search: true},
  {id: "pixabay", label: "Pixabay", text: false, image: false, search: true}
] as const;

export class ProviderService {
  constructor(private readonly repository: ProviderSecretRepository, private readonly cipher?: SecretCipher) {}

  list(userId: string) {
    const configured = new Map(this.repository.listForUser(userId).map((secret) => [secret.provider, secret]));
    return providerDefinitions.map((definition) => publicProvider(definition, configured.get(definition.id)));
  }

  save(userId: string, provider: string, value: unknown) {
    const definition = requireProvider(provider);
    if (!this.cipher) throw new ApiError(503, "SECRET_STORAGE_UNAVAILABLE", "Provider key storage is not configured on this server.");
    if (typeof value !== "string" || value.trim().length < 8 || value.length > 4096) {
      throw new ApiError(400, "PROVIDER_KEY_INVALID", "The provider key must be between 8 and 4096 characters.");
    }
    const normalized = value.trim();
    this.repository.saveUserProvider(userId, definition.id, this.cipher.encrypt(normalized), normalized.slice(-4), new Date().toISOString());
    return publicProvider(definition, this.repository.findUserProvider(userId, definition.id));
  }

  remove(userId: string, provider: string): void {
    requireProvider(provider);
    this.repository.deleteUserProvider(userId, provider);
  }

  test(userId: string, provider: string, mode: "fixture" | "live") {
    const definition = requireProvider(provider);
    const secret = this.repository.findUserProvider(userId, definition.id);
    if (!secret) throw new ApiError(404, "PROVIDER_KEY_MISSING", "Save a provider key before testing it.");
    if (!this.cipher) throw new ApiError(503, "SECRET_STORAGE_UNAVAILABLE", "Provider key storage is not configured on this server.");
    this.cipher.decrypt(secret);
    if (mode === "live") throw new ApiError(503, "LIVE_PROVIDER_TEST_DISABLED", "Live provider testing must be run through the explicit verification workflow.");
    const now = new Date().toISOString();
    this.repository.updateTestStatus(userId, definition.id, definition.text ? "available" : "untested", definition.image || definition.search ? "available" : "untested", now);
    return publicProvider(definition, this.repository.findUserProvider(userId, definition.id));
  }

  resolve(userId: string, provider: string): {value: string; source: "user" | "platform"} {
    requireProvider(provider);
    if (!this.cipher) throw new ApiError(503, "SECRET_STORAGE_UNAVAILABLE", "Provider key storage is not configured on this server.");
    const userSecret = this.repository.findUserProvider(userId, provider);
    const selected = userSecret?.status === "active" ? userSecret : this.repository.findPlatformProvider(provider);
    if (!selected || selected.status !== "active") throw new ApiError(503, "PROVIDER_UNAVAILABLE", `Configure ${provider} in Settings or ask an administrator to configure a platform key.`);
    return {value: this.cipher.decrypt(selected), source: selected.scope};
  }
  listPlatform() { const configured = new Map(this.repository.listPlatform().map((secret) => [secret.provider, secret])); return providerDefinitions.map((definition) => publicProvider(definition, configured.get(definition.id))); }
  savePlatform(provider: string, value: unknown) { const definition = requireProvider(provider); if (!this.cipher) throw new ApiError(503, "SECRET_STORAGE_UNAVAILABLE", "Provider key storage is not configured on this server."); if (typeof value !== "string" || value.trim().length < 8 || value.length > 4096) throw new ApiError(400, "PROVIDER_KEY_INVALID", "The provider key must be between 8 and 4096 characters."); const normalized = value.trim(); this.repository.savePlatformProvider(definition.id, this.cipher.encrypt(normalized), normalized.slice(-4), new Date().toISOString()); return publicProvider(definition, this.repository.findPlatformProvider(definition.id)); }
  disablePlatform(provider: string): void { requireProvider(provider); if (!this.repository.disablePlatform(provider, new Date().toISOString())) throw new ApiError(404, "PROVIDER_KEY_MISSING", "No platform key is configured."); }
}

function requireProvider(id: string) {
  const provider = providerDefinitions.find((candidate) => candidate.id === id);
  if (!provider) throw new ApiError(404, "PROVIDER_NOT_FOUND", "The provider is not supported.");
  return provider;
}

function publicProvider(definition: typeof providerDefinitions[number], secret?: ProviderSecretRecord) {
  return {
    id: definition.id,
    label: definition.label,
    capabilities: {text: definition.text, image: definition.image, search: definition.search},
    configured: Boolean(secret),
    lastFour: secret?.lastFour ?? null,
    status: secret?.status ?? "missing",
    textTestStatus: secret?.textTestStatus ?? "untested",
    imageTestStatus: secret?.imageTestStatus ?? "untested",
    lastTestedAt: secret?.lastTestedAt ?? null
  };
}
