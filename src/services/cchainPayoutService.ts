import { getAddress, isAddress, type Address } from 'viem';
import db from '../db';
import { OrderState, ProcessingState } from '../models/types';
import { fireCallback } from './callbackService';
import { loadCchainConfig } from '../config/cchain';
import {
  getPublicClient,
  getWalletClientForAccount,
  getNativeUsdtContract,
  getBalance,
  getUsdtBalance,
  USDT_ABI,
} from './cchainRpcService';
import { buildTxOverrides, NATIVE_TRANSFER_GAS } from './cchainSweepService';
import { getPayoutAccount, getPayoutAddress } from './cchainPayoutAccount';
import {
  decimalsForAsset,
  fetchUsdtDecimals,
  isUsdtToken,
  toUnits,
  USDT_DECIMALS_FALLBACK,
} from './cchainUnits';

export interface CchainDisburseResult {
  success: boolean;
  hash?: string;
  txID?: string;
  /** True when the tx is submitted but still gathering confirmations. */
  pending?: boolean;
  /** True when the order was already completed and no transfer was sent. */
  skipped?: boolean;
  error?: string;
}

interface PayoutOrderRow {
  id: number;
  order_state: number;
  processing_state: number | null;
  transaction_hash: string | null;
  recipient: string | null;
  asset_code: string | null;
  token_address: string | null;
  usdt_amount: string | number;
  callback: string | null;
}

const PAYOUT_IN_FLIGHT = 13;
const PAYOUT_COMPLETED = 14;
const PAYOUT_FAILED = 15;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function completeOrder(order: PayoutOrderRow, hash: string): Promise<CchainDisburseResult> {
  await db('orders')
    .where({ id: order.id })
    .update({
      order_state: OrderState.COMPLETED,
      processing_state: PAYOUT_COMPLETED,
      transaction_hash: hash,
      payment_status: 'payment_received',
    });

  if (order.callback) {
    fireCallback(
      order.callback,
      order.id,
      OrderState.PROCESSING,
      OrderState.COMPLETED,
      PAYOUT_IN_FLIGHT,
      PAYOUT_COMPLETED,
      hash
    ).catch((err) => console.error('[CchainPayout] fireCallback failed:', err));
  }

  return { success: true, hash, txID: hash };
}

async function failOrder(
  order: PayoutOrderRow,
  error: string,
  hash?: string
): Promise<CchainDisburseResult> {
  const errorMsg = error.slice(0, 500);
  await db('orders')
    .where({ id: order.id })
    .update({
      order_state: OrderState.FAILED,
      processing_state: PAYOUT_FAILED,
      error_message: errorMsg,
      payment_status: 'failed',
      ...(hash ? { transaction_hash: hash } : {}),
    });

  if (order.callback) {
    fireCallback(
      order.callback,
      order.id,
      OrderState.PROCESSING,
      OrderState.FAILED,
      PAYOUT_IN_FLIGHT,
      PAYOUT_FAILED,
      hash
    ).catch((err) => console.error('[CchainPayout] fireCallback failed:', err));
  }

  return { success: false, error: errorMsg, ...(hash ? { hash, txID: hash } : {}) };
}

/** Wait for a submitted payout and complete or fail the order based on confirmations. */
async function confirmPayout(order: PayoutOrderRow, hash: string): Promise<CchainDisburseResult> {
  const cfg = loadCchainConfig();
  const publicClient = getPublicClient();
  const timeout = Number(process.env.CCHAIN_PAYOUT_TIMEOUT_MS || 60_000);

  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
      timeout,
    });
    if (receipt.status === 'reverted') {
      return failOrder(order, 'PAYOUT_REVERTED', hash);
    }

    const confirmations = await publicClient.getTransactionConfirmations({ hash: hash as `0x${string}` });
    if (Number(confirmations) < cfg.payoutConfirmations) {
      return { success: true, pending: true, hash, txID: hash };
    }

    return completeOrder(order, hash);
  } catch (error) {
    return failOrder(order, `PAYOUT_NOT_ACCEPTED: ${errorMessage(error)}`, hash);
  }
}

/**
 * Disburse a buy order on the Avalanche C-Chain: native AVAX or ERC-20 USDT to
 * the recipient's 0x address. Idempotent — an order with an existing payout hash
 * is reconciled rather than re-sent, and completed orders are skipped.
 */
export async function disburseCchain(
  orderId: number,
  recipient: string,
  amount: string,
  assetCode: string,
  tokenAddress?: string | null
): Promise<CchainDisburseResult> {
  const order = await db('orders').where({ id: orderId }).first<PayoutOrderRow>();
  if (!order) {
    return { success: false, error: 'ORDER_NOT_FOUND' };
  }

  if (order.order_state === OrderState.COMPLETED) {
    const existing = order.transaction_hash || undefined;
    return { success: true, skipped: true, hash: existing, txID: existing };
  }

  if (order.order_state !== OrderState.PROCESSING) {
    return { success: false, error: 'ORDER_NOT_ELIGIBLE' };
  }

  // Idempotency: reconcile a previously submitted payout instead of sending again.
  if (order.transaction_hash) {
    return confirmPayout(order, order.transaction_hash);
  }

  if (!recipient || !isAddress(recipient)) {
    return failOrder(order, 'RECIPIENT_INVALID_ADDRESS');
  }
  const to = getAddress(recipient) as Address;

  await db('orders').where({ id: order.id }).update({ processing_state: PAYOUT_IN_FLIGHT });

  let account;
  try {
    account = await getPayoutAccount();
  } catch (error) {
    return failOrder(order, `PAYOUT_WALLET_NOT_CONFIGURED: ${errorMessage(error)}`);
  }

  const isUsdt = isUsdtToken(tokenAddress) || (assetCode || '').toUpperCase() === 'USDT';
  let amountUnits: bigint;
  try {
    amountUnits = toUnits(amount, decimalsForAsset(assetCode, tokenAddress));
  } catch (error) {
    return failOrder(order, errorMessage(error));
  }

  const cfg = loadCchainConfig();
  const overrides = await buildTxOverrides();
  const gasCost = NATIVE_TRANSFER_GAS * overrides.maxFeePerGas;

  try {
    if (isUsdt) {
      const [tokenBalance, gasBalance] = await Promise.all([
        getUsdtBalance(account.address),
        getBalance(account.address),
      ]);
      if (tokenBalance < amountUnits) {
        return failOrder(
          order,
          `INSUFFICIENT_BALANCE: available ${tokenBalance}, required ${amountUnits}`
        );
      }
      if (gasBalance < cfg.avaxGasReserveWei + gasCost) {
        return failOrder(
          order,
          `INSUFFICIENT_GAS: available ${gasBalance}, required ${cfg.avaxGasReserveWei + gasCost}`
        );
      }
    } else {
      const balance = await getBalance(account.address);
      if (balance < amountUnits + gasCost) {
        return failOrder(
          order,
          `INSUFFICIENT_BALANCE: available ${balance}, required ${amountUnits + gasCost}`
        );
      }
    }
  } catch (error) {
    return failOrder(order, `PAYOUT_PREFLIGHT_FAILED: ${errorMessage(error)}`);
  }

  const wallet = getWalletClientForAccount(account);
  let hash: string;
  try {
    if (isUsdt) {
      hash = await wallet.writeContract({
        address: getNativeUsdtContract(),
        abi: USDT_ABI,
        functionName: 'transfer',
        args: [to, amountUnits],
        ...overrides,
      } as never);
    } else {
      hash = await wallet.sendTransaction({
        to,
        value: amountUnits,
        ...overrides,
      } as never);
    }
  } catch (error) {
    return failOrder(order, `PAYOUT_SUBMIT_FAILED: ${errorMessage(error)}`);
  }

  // Record the hash before awaiting confirmation so a crash cannot cause a re-send.
  await db('orders').where({ id: order.id }).update({ transaction_hash: hash });
  return confirmPayout(order, hash);
}

/**
 * Recover buy orders left in the in-flight payout state after a restart:
 * reconcile orders with a recorded hash, re-attempt those without one.
 */
export async function sweepStuckCchainPayouts(): Promise<number> {
  const stuck = await db('orders')
    .where('processing_state', PAYOUT_IN_FLIGHT)
    .whereIn('order_state', [OrderState.PROCESSING])
    .select(
      'id',
      'order_state',
      'processing_state',
      'transaction_hash',
      'recipient',
      'asset_code',
      'token_address',
      'usdt_amount',
      'callback'
    ) as PayoutOrderRow[];

  console.log(`[CchainPayout] Sweep: found ${stuck.length} in-flight payouts`);

  let processed = 0;
  for (const order of stuck) {
    try {
      if (order.transaction_hash) {
        await confirmPayout(order, order.transaction_hash);
      } else if (order.recipient) {
        await disburseCchain(
          order.id,
          order.recipient,
          String(order.usdt_amount),
          order.asset_code || 'AVAX',
          order.token_address
        );
      }
      processed += 1;
    } catch (error) {
      console.error(`[CchainPayout] Failed to recover order ${order.id}:`, errorMessage(error));
    }
  }

  return processed;
}

/**
 * Resolve the payout wallet at startup and verify the USDT contract precision.
 * No-op when the C-Chain RPC is not configured.
 */
export async function initCchainPayout(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!env.CCHAIN_RPC_BASE_URL?.trim()) {
    console.log('[CchainPayout] C-Chain RPC not configured, skipping payout init');
    return;
  }
  const address = await getPayoutAddress(env);
  console.log(`[CchainPayout] Payout wallet: ${address}`);

  const decimals = await fetchUsdtDecimals(env);
  if (decimals !== USDT_DECIMALS_FALLBACK) {
    throw new Error(
      `CCHAIN_USDT_DECIMALS_MISMATCH: expected ${USDT_DECIMALS_FALLBACK}, got ${decimals}`
    );
  }
  console.log(`[CchainPayout] USDT contract decimals verified: ${decimals}`);
}
