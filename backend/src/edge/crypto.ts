import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const getSecretsKey = (): Buffer => {
  const key = process.env.SHADE_SECRETS_KEY;
  if (!key) {
    throw new Error("SHADE_SECRETS_KEY environment variable is required for secrets encryption");
  }
  // Accept either a 32-byte hex string (64 chars) or a 32-byte base64 string
  if (key.length === 64) {
    return Buffer.from(key, "hex");
  }
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("SHADE_SECRETS_KEY must be 32 bytes (64 hex chars or base64-encoded)");
  }
  return buf;
};

export const encryptSecrets = (plaintext: Record<string, unknown>): string => {
  const key = getSecretsKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(plaintext);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

export const decryptSecrets = (encrypted: string): Record<string, unknown> => {
  const key = getSecretsKey();
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secrets format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
};

export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const generateToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};
