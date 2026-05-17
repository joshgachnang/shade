import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import crypto from "node:crypto";
import {decryptSecrets, encryptSecrets, generateToken, hashToken} from "./crypto";

describe("edge crypto", () => {
  const testKey = crypto.randomBytes(32).toString("hex");

  beforeAll(() => {
    process.env.SHADE_SECRETS_KEY = testKey;
  });

  afterAll(() => {
    delete process.env.SHADE_SECRETS_KEY;
  });

  test("hashToken produces consistent SHA-256 hash", () => {
    const token = "test-token-123";
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // 32 bytes hex
  });

  test("hashToken produces different hashes for different tokens", () => {
    const hash1 = hashToken("token-a");
    const hash2 = hashToken("token-b");
    expect(hash1).not.toBe(hash2);
  });

  test("generateToken produces 64-char hex string", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  test("generateToken produces unique tokens", () => {
    const tokens = new Set(Array.from({length: 10}, () => generateToken()));
    expect(tokens.size).toBe(10);
  });

  test("encrypt then decrypt roundtrips secrets", () => {
    const secrets = {apiKey: "sk-test-123", webhook: "https://example.com/hook"};
    const encrypted = encryptSecrets(secrets);
    const decrypted = decryptSecrets(encrypted);
    expect(decrypted).toEqual(secrets);
  });

  test("encrypted format has three base64 parts", () => {
    const encrypted = encryptSecrets({foo: "bar"});
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
  });

  test("decrypt fails with tampered data", () => {
    const encrypted = encryptSecrets({foo: "bar"});
    const parts = encrypted.split(":");
    // Tamper with the ciphertext
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecrets(parts.join(":"))).toThrow();
  });

  test("encrypt produces different output each time (random IV)", () => {
    const secrets = {same: "data"};
    const enc1 = encryptSecrets(secrets);
    const enc2 = encryptSecrets(secrets);
    expect(enc1).not.toBe(enc2);
  });
});
