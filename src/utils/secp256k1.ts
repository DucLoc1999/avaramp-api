import type { Hex } from 'viem';

const SECP256K1_P = 2n ** 256n - 2n ** 32n - 977n;

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * Decompress a 33-byte secp256k1 public key (`02/03 || X`) into the 65-byte
 * uncompressed form (`04 || X || Y`) expected by viem's `publicKeyToAddress`.
 */
export function decompressSecp256k1PublicKey(compressed: Buffer | Uint8Array): Hex {
  const bytes = Buffer.from(compressed);
  if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) {
    throw new Error('INVALID_COMPRESSED_PUBLIC_KEY');
  }
  const prefix = bytes[0];
  const x = BigInt('0x' + bytes.subarray(1).toString('hex'));
  const y2 = (modPow(x, 3n, SECP256K1_P) + 7n) % SECP256K1_P;
  let y = modPow(y2, (SECP256K1_P + 1n) / 4n, SECP256K1_P);
  if ((y & 1n) !== BigInt(prefix & 1)) {
    y = SECP256K1_P - y;
  }
  const xHex = x.toString(16).padStart(64, '0');
  const yHex = y.toString(16).padStart(64, '0');
  return `0x04${xHex}${yHex}`;
}
