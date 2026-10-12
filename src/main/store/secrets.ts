import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import type { Paths } from "./paths";

export type SecretKey = "openai" | "composio" | "cloud";

/** Encryption is injected so the store works outside Electron (smoke tests use plaintext). */
export interface Cipher {
  encrypt(plain: string): Buffer;
  decrypt(buf: Buffer): string;
}

export const plainCipher: Cipher = {
  encrypt: (s) => Buffer.from(s, "utf8"),
  decrypt: (b) => b.toString("utf8"),
};

export class SecretsStore {
  private cache: Partial<Record<SecretKey, string>> | null = null;
  constructor(private paths: Paths, private cipher: Cipher, private envFallback: Partial<Record<SecretKey, string>> = {}) {}

  private load(): Partial<Record<SecretKey, string>> {
    if (this.cache) return this.cache;
    try {
      if (existsSync(this.paths.secrets)) {
        this.cache = JSON.parse(this.cipher.decrypt(readFileSync(this.paths.secrets)));
      } else this.cache = {};
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }
  private save() {
    writeFileSync(this.paths.secrets, this.cipher.encrypt(JSON.stringify(this.cache ?? {})));
    try {
      chmodSync(this.paths.secrets, 0o600);
    } catch {}
  }
  get(key: SecretKey): string | undefined {
    return this.load()[key] || this.envFallback[key] || undefined;
  }
  set(key: SecretKey, value: string) {
    this.load()[key] = value.trim();
    this.save();
  }
  clear(key: SecretKey) {
    delete this.load()[key];
    this.save();
  }
  status() {
    return { openai: !!this.get("openai"), composio: !!this.get("composio") };
  }
}
