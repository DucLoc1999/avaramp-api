import crypto from 'crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { recoverPublicKey, toHex } from 'viem';
import { loadGcpKmsConfig } from '../config/gcpKms';
import { decompressSecp256k1PublicKey } from '../utils/secp256k1';

const SIGN_RETRY_COUNT = 2;
const SIGN_RETRY_DELAY_MS = 200;

export class KmsSigningError extends Error {
  code: 'KMS_AUTH_ERROR' | 'KMS_SIGNING_ERROR';

  constructor(message: string, code: 'KMS_AUTH_ERROR' | 'KMS_SIGNING_ERROR') {
    super(message);
    this.name = 'KmsSigningError';
    this.code = code;
  }
}

let client: KeyManagementServiceClient | null = null;

function getClient(): KeyManagementServiceClient {
  if (!client) {
    client = new KeyManagementServiceClient();
  }
  return client;
}

export function keyVersionPath(): string {
  const config = loadGcpKmsConfig();
  return getClient().cryptoKeyVersionPath(
    config.projectId,
    config.locationId,
    config.keyRing,
    config.keyId,
    config.keyVersion
  );
}

function classifyError(error: unknown): KmsSigningError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('default credentials') ||
    lower.includes('could not load') ||
    lower.includes('unauthenticated') ||
    lower.includes('permission denied') ||
    lower.includes('forbidden')
  ) {
    return new KmsSigningError(message, 'KMS_AUTH_ERROR');
  }
  return new KmsSigningError(message, 'KMS_SIGNING_ERROR');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sign a 32-byte digest with the configured secp256k1 KMS key. Returns a
 * 65-byte recoverable signature (r‖s‖v, v ∈ {0,1}) suitable for Ethereum
 * (`yParity`) or other secp256k1 consumers.
 *
 * GCP KMS's `EC_SIGN_SECP256K1_SHA256` returns a DER-encoded ECDSA signature.
 * We decode DER → (r, s), normalize low-`s`, and resolve the recovery id `v`
 * by recovering the public key against the KMS public key.
 */
export async function signTxHash(digest: Buffer): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SIGN_RETRY_COUNT; attempt += 1) {
    try {
      const [response] = await getClient().asymmetricSign({
        name: keyVersionPath(),
        digest: {
          sha256: digest,
        },
      });
      if (!response.signature) {
        throw new Error('KMS returned an empty signature');
      }
      return derToRecoverableSignature(Buffer.from(response.signature), digest, await getKmsPublicKeyCompressed());
    } catch (error) {
      lastError = error;
      if (attempt < SIGN_RETRY_COUNT) {
        await sleep(SIGN_RETRY_DELAY_MS);
      }
    }
  }
  throw classifyError(lastError);
}

function parseDerSignature(der: Buffer): { r: bigint; s: bigint } {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature: missing SEQUENCE header');
  const seqLen = der[offset++];
  const end = offset + seqLen;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: expected INTEGER r');
  let rLen = der[offset++];
  let r = BigInt('0x' + der.subarray(offset, offset + rLen).toString('hex'));
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER signature: expected INTEGER s');
  let sLen = der[offset++];
  let s = BigInt('0x' + der.subarray(offset, offset + sLen).toString('hex'));
  offset += sLen;
  if (offset !== end) throw new Error('Invalid DER signature: trailing bytes');
  void rLen;
  void sLen;
  return { r, s };
}

function encodeBigIntAsPadded(value: bigint, length: number): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, '0');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== length) {
    throw new Error('bigint out of range for signature field');
  }
  return bytes;
}

const N = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
);

async function derToRecoverableSignature(
  der: Buffer,
  digest: Buffer,
  compressedPublicKey: Uint8Array
): Promise<Buffer> {
  const { r, s } = parseDerSignature(der);

  // Normalize to the lower half of the curve order (low-s).
  let sFinal = s;
  if (s > N / 2n) {
    sFinal = N - s;
  }

  const rBytes = encodeBigIntAsPadded(r, 32);
  const sBytes = encodeBigIntAsPadded(sFinal, 32);

  // Resolve recovery id v ∈ {0,1} by recovery, comparing the recovered
  // public key against the KMS public key (uncompressed).
  const expected = decompressSecp256k1PublicKey(compressedPublicKey).toLowerCase();
  for (let v = 0; v < 2; v++) {
    const candidate = Buffer.concat([rBytes, sBytes, Buffer.from([v])]);
    try {
      const recovered = await recoverPublicKey({
        hash: toHex(digest),
        signature: toHex(candidate) as `0x${string}`,
      });
      if (recovered.toLowerCase() === expected) {
        return candidate;
      }
    } catch {
      // try next v
    }
  }
  throw new KmsSigningError(
    'KMS_SIGNING_ERROR: unable to resolve recovery id against KMS public key',
    'KMS_SIGNING_ERROR'
  );
}

export function parseSecp256k1PublicKeyPem(pem: string): Buffer {
  const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }) as Buffer;
  // Walk the DER: SEQUENCE { SEQUENCE { OID ... }, BIT STRING { <point> } }.
  let offset = 0;
  const readSeq = (): number => {
    if (spki[offset++] !== 0x30) throw new Error('Invalid SPKI: expected SEQUENCE');
    const len = spki[offset++];
    if (len & 0x80) offset += len & 0x7f;
    return offset + len;
  };
  const seqEnd = readSeq();
  const algEnd = readSeq();
  // AlgId: one or two OID (0x06) nodes.
  while (offset < algEnd - 2) {
    if (spki[offset] !== 0x06) break;
    const oidLen = spki[offset + 1];
    offset += 2 + oidLen;
  }
  if (spki[offset++] !== 0x03) throw new Error('Unexpected SPKI structure for secp256k1 key');
  const pointLen = spki[offset++] - 1; // minus the unused-bits octet
  offset += 1; // unused-bits octet
  const point = spki.subarray(offset, seqEnd);
  if (seqEnd !== offset + pointLen) throw new Error('Invalid SPKI: trailing bytes');
  if (point.length === 65 && point[0] === 0x04) {
    // Uncompressed 04 || X || Y → compressed 02/03 || X
    const x = point.subarray(1, 33);
    const y = point.subarray(33, 65);
    const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
    return Buffer.concat([Buffer.from([prefix]), x]);
  }
  if (point.length !== 33) {
    throw new Error(`Unexpected secp256k1 public key length: ${point.length}`);
  }
  return Buffer.from(point);
}

// Compressed public-key cache keyed by the KMS key-version path: changing
// GCP_KMS_KEY_VERSION at runtime resolves a new key automatically.
const compressedPubkeyCache = new Map<string, Buffer>();

export async function getKmsPublicKeyCompressed(): Promise<Buffer> {
  const path = keyVersionPath();
  const cached = compressedPubkeyCache.get(path);
  if (cached) return cached;
  const [publicKey] = await getClient().getPublicKey({ name: path });
  if (!publicKey.pem) {
    throw new Error('KMS returned no public key');
  }
  const compressed = parseSecp256k1PublicKeyPem(publicKey.pem);
  compressedPubkeyCache.set(path, compressed);
  return compressed;
}

export function resetPublicKeyCache(): void {
  compressedPubkeyCache.clear();
}