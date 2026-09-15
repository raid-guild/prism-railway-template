import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  encryptedValue: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
  associatedDataJson: string;
};

export function parseMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (decoded.length !== 32) {
    throw new Error("GATEWAY_MASTER_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters");
  }

  return decoded;
}

function associatedData(connectionId: string, secretName: string, keyVersion: string) {
  return JSON.stringify({ connectionId, secretName, keyVersion });
}

export function encryptSecret(
  value: string,
  context: { connectionId: string; secretName: string; keyVersion: string; key: Buffer },
): EncryptedSecret {
  const nonce = randomBytes(12);
  const associatedDataJson = associatedData(context.connectionId, context.secretName, context.keyVersion);
  const cipher = createCipheriv("aes-256-gcm", context.key, nonce);
  cipher.setAAD(Buffer.from(associatedDataJson, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    encryptedValue: encrypted.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: context.keyVersion,
    associatedDataJson,
  };
}

export function decryptSecret(
  secret: EncryptedSecret,
  context: { connectionId: string; secretName: string; key: Buffer },
): string {
  const expectedAssociatedData = associatedData(context.connectionId, context.secretName, secret.keyVersion);
  if (secret.associatedDataJson !== expectedAssociatedData) {
    throw new Error("ENCRYPTED_SECRET_CONTEXT_MISMATCH");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    context.key,
    Buffer.from(secret.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(secret.associatedDataJson, "utf8"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedValue, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
