import crypto from 'crypto';

const ENCRYPT_KEY_ENV = 'CUSTODIAL_KEY_ENCRYPTION_KEY';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

function bytesToHex(buf: Buffer): string {
  return buf.toString('hex');
}

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

function deriveKey(env = process.env): Buffer {
  const raw = env[ENCRYPT_KEY_ENV]?.trim();
  if (!raw || raw.length < 32) {
    throw new Error(`${ENCRYPT_KEY_ENV} must be set to a string of at least 32 characters`);
  }
  // SHA-256 the secret to a fixed 32-byte AES-256-GCM key.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * Encrypt a custodial private key with AES-256-GCM. `aad` binds the ciphertext
 * to a piece of context (the order id) so a ciphertext relocated across orders
 * is rejected at decryption. Returns hex-encoded iv/tag/ciphertext.
 */
export function encryptPrivateKey(
  privateKeyHex: string,
  aad = '0',
  env: NodeJS.ProcessEnv = process.env
): EncryptedPayload {
  const key = deriveKey(env);
  const iv = crypto.randomBytes(IV_LENGTH);
  const aadBuf = Buffer.from(String(aad), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadBuf);
  const ciphertext = Buffer.concat([
    cipher.update(privateKeyHex, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return { iv: bytesToHex(iv), tag: bytesToHex(tag), ciphertext: bytesToHex(ciphertext) };
}

/**
 * Decrypt a custodial private key. `aad` MUST match the value used at encrypt
 * time, otherwise the GCM tag check fails and the key is rejected.
 */
export function decryptPrivateKey(
  payload: EncryptedPayload,
  aad = '0',
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = deriveKey(env);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, hexToBytes(payload.iv));
  decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(hexToBytes(payload.tag));
  const plaintext = Buffer.concat([
    decipher.update(hexToBytes(payload.ciphertext)),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Allowed test override to avoid deriving from a global env at unit-test time. */
export function validateEncryptionKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENCRYPT_KEY_ENV]?.trim();
  return !!raw && raw.length >= 32;
}