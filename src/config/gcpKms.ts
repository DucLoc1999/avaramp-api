export interface GcpKmsConfig {
  projectId: string;
  locationId: string;
  keyRing: string;
  keyId: string;
  keyVersion: string;
}

/**
 * The KMS crypto key MUST be a secp256k1 asymmetric signing key
 * (algorithm `EC_SIGN_SECP256K1_SHA256`). X-Chain (AVM) transactions are
 * signed over their SHA256 digest with a DER → r‖s‖v credential, and the
 * hot-wallet bech32 address is derived from the same key's public point.
 */
export const EXPECTED_KMS_ALGORITHM = 'EC_SIGN_SECP256K1_SHA256';

export function loadGcpKmsConfig(env: NodeJS.ProcessEnv = process.env): GcpKmsConfig {
  const required: Record<Exclude<keyof GcpKmsConfig, 'keyVersion'>, string | undefined> = {
    projectId: env.GCP_KMS_PROJECT_ID,
    locationId: env.GCP_KMS_LOCATION_ID,
    keyRing: env.GCP_KMS_KEY_RING,
    keyId: env.GCP_KMS_KEY_ID,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase());

  if (missing.length > 0) {
    throw new Error(`Missing GCP KMS configuration: ${missing.join(', ')}`);
  }

  const keyVersion = env.GCP_KMS_KEY_VERSION?.trim() || '1';
  if (!/^\d+$/.test(keyVersion)) {
    throw new Error(`Invalid GCP_KMS_KEY_VERSION '${keyVersion}': must be a positive integer`);
  }

  return {
    ...(required as Record<keyof typeof required, string>),
    keyVersion,
  };
}
