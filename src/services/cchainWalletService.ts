import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import { getAddress } from 'viem';
import db from '../db';
import { encryptPrivateKey, decryptPrivateKey, EncryptedPayload } from './custodialCipherService';
import { getBlockNumber } from './cchainRpcService';

/**
 * The C-Chain custodial sell/deposit flow is enabled when the C-Chain RPC and
 * custodial key-encryption key are both configured.
 */
export function isCChainCustodialEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.CCHAIN_RPC_BASE_URL?.trim() && !!env.CUSTODIAL_KEY_ENCRYPTION_KEY?.trim();
}

export interface CustodialWalletRow {
  id: number;
  order_id: number;
  index: number;
  address: string;
  encrypted_private_key: EncryptedPayload | null;
  swept_navax_block: string | null;
  swept_usdt_txhash: string | null;
  last_scanned_block: string | null;
  native_baseline: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Provisions a unique Ethereum-compatible EOA (0x) custodial deposit wallet per
 * sell order. The private key is encrypted at rest (AES-256-GCM, AAD = order id)
 * and NEVER returned or logged; only the derived 0x address is exposed.
 *
 * Derivation uses freshly generated entropy (viem `generatePrivateKey`). A
 * stable bip32-style derivation from a master seed is an accepted alternative;
 * here each order draws fresh entropy and the derived key is persisted encrypted
 * so it does not need to be re-derived at sweep time.
 */
export async function provisionCustodialWallet(
  orderId: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const index = await nextWalletIndex(env);
  const privateKey = generatePrivateKey();

  const account = privateKeyToAccount(privateKey);
  const address = getAddress(account.address);

  const encrypted = encryptPrivateKey(privateKey, String(orderId), env);

  // Initialize the listener cursor: baseline 0 so any incoming AVAX is detected
  // across restarts, and the current block so USDT log scanning starts here.
  let currentBlock: string | null = null;
  try {
    currentBlock = (await getBlockNumber(env)).toString();
  } catch {
    currentBlock = null;
  }

  await db
    .insert({
      order_id: orderId,
      index,
      address,
      encrypted_private_key: encrypted,
      native_baseline: '0',
      last_scanned_block: currentBlock,
    })
    .into('custodial_wallets')
    .onConflict('order_id')
    .merge(['address', 'encrypted_private_key', 'updated_at']);

  return address;
}

async function nextWalletIndex(env: NodeJS.ProcessEnv): Promise<number> {
  const row = await db('custodial_wallets').max('index as maxIndex').first<{ maxIndex: number | null }>();
  const max = row?.maxIndex ?? -1;
  return Number(max) + 1;
}

/** Return the custodial deposit address for an order, or null if none exists. */
export async function getDepositAddress(orderId: number): Promise<string | null> {
  const row = await db('custodial_wallets').where({ order_id: orderId }).first<CustodialWalletRow>();
  return row ? row.address : null;
}

/** Return the decrypted privkey hex for a custodial address (in-memory only). */
export async function getPrivateKeyByAddress(
  address: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const row = await db('custodial_wallets').where({ address }).first<CustodialWalletRow>();
  return getPrivateKeyFromRow(row, env);
}

export async function getPrivateKeyByOrderId(
  orderId: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const row = await db('custodial_wallets').where({ order_id: orderId }).first<CustodialWalletRow>();
  return getPrivateKeyFromRow(row, env);
}

function getPrivateKeyFromRow(row: CustodialWalletRow | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!row?.encrypted_private_key) return null;
  try {
    const payload =
      typeof row.encrypted_private_key === 'string'
        ? (JSON.parse(row.encrypted_private_key) as EncryptedPayload)
        : row.encrypted_private_key;
    return decryptPrivateKey(payload, String(row.order_id), env);
  } catch (err) {
    console.error(
      `[CchainWallet] Failed to decrypt custodial key for order ${row.order_id}: ${(err as Error).message}`
    );
    return null;
  }
}

/** All active custodial deposit addresses. */
export async function listActiveCustodialAddresses(): Promise<CustodialWalletRow[]> {
  return db('custodial_wallets').orderBy('created_at', 'asc');
}

export async function updateSweptState(
  orderId: number,
  patch: Partial<Pick<CustodialWalletRow, 'swept_navax_block' | 'swept_usdt_txhash'>>
): Promise<void> {
  await db('custodial_wallets')
    .where({ order_id: orderId })
    .update({ ...patch, updated_at: new Date() });
}

/** Persist the listener cursor (last scanned block / native baseline) for an address. */
export async function updateListenerCursor(
  address: string,
  patch: Partial<Pick<CustodialWalletRow, 'last_scanned_block' | 'native_baseline'>>
): Promise<void> {
  await db('custodial_wallets')
    .where({ address })
    .update({ ...patch, updated_at: new Date() });
}