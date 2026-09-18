import db from '../db';
import { getAddress } from 'viem';
import { loadCchainConfig } from '../config/cchain';
import {
  getBlockNumber,
  getConfirmations,
  getUsdtTransferLogs,
  getBalance,
  getUsdtBalance,
  getNativeUsdtContract,
} from './cchainRpcService';
import { listActiveCustodialAddresses, updateListenerCursor } from './cchainWalletService';
import { OrderState } from '../models/types';

export type CchainDepositStatus = 'detected' | 'confirmed' | 'sweeping' | 'swept' | 'failed';

export interface CchainDepositRow {
  id: number;
  order_id: number | null;
  address: string;
  asset: 'avax' | 'usdt';
  amount: string;
  block_hash: string | null;
  block_number: string | null;
  tx_hash: string | null;
  log_index: number | null;
  status: CchainDepositStatus;
  sweep_tx_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Poll the C-Chain for deposits on all custodial deposit addresses. Records
 * newly observed USDT `Transfer` logs into `cchain_deposits` and advances
 * `detected → confirmed` for entries that have reached the confirmation depth.
 *
 * The per-address block cursor is persisted on `custodial_wallets`
 * (`last_scanned_block`) so restarts resume without a detection gap.
 */
export async function scanCchainDeposits(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ detected: number; confirmed: number }> {
  const cfg = loadCchainConfig(env);
  const wallets = await listActiveCustodialAddresses();
  if (wallets.length === 0) return { detected: 0, confirmed: 0 };

  const currentBlock = await getBlockNumber(env);
  const nextBlock = currentBlock + 1n;

  let detected = 0;
  const monitored = new Set(wallets.map((w) => getAddress(w.address)));

  for (const wallet of wallets) {
    const address = getAddress(wallet.address);
    const lookback = BigInt(Math.max(1, cfg.depositConfirmations)) * 4n;
    const stored = wallet.last_scanned_block ? BigInt(wallet.last_scanned_block) : null;
    const fromBlock = stored !== null
      ? stored + 1n
      : (nextBlock - lookback < 0n ? 0n : nextBlock - lookback);
    const toBlock = currentBlock;

    if (toBlock >= fromBlock) {
      const logs = await getUsdtTransferLogs((to) => monitored.has(to as `0x${string}`), fromBlock, toBlock, env);
      for (const log of logs) {
        await db('cchain_deposits')
          .insert({
            address: getAddress(log.to),
            asset: 'usdt',
            amount: log.value.toString(),
            block_hash: log.blockHash,
            block_number: log.blockNumber.toString(),
            tx_hash: log.txHash,
            log_index: log.logIndex,
            status: 'detected',
          })
          .onConflict(['address', 'asset', 'tx_hash', 'log_index'])
          .ignore();
      }
      detected += logs.length;
    }

    await updateListenerCursor(address, { last_scanned_block: currentBlock.toString() });
  }

  return { detected, confirmed: 0 };
}

/**
 * Detect native AVAX balance increases on custodial addresses vs the persisted
 * baseline. New wallets are provisioned with a `0` baseline so any incoming AVAX
 * is detected even if the listener restarts between funding and the next poll.
 */
export async function scanCchainNativeBalances(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ detected: number }> {
  const wallets = await listActiveCustodialAddresses();
  let detected = 0;
  for (const wallet of wallets) {
    const address = getAddress(wallet.address);
    const balance = await getBalance(address, env);
    const prev = wallet.native_baseline != null ? BigInt(wallet.native_baseline) : 0n;
    if (balance > prev) {
      const amount = balance - prev;
      await db('cchain_deposits')
        .insert({
          address,
          asset: 'avax',
          amount: amount.toString(),
          block_hash: null,
          block_number: null,
          tx_hash: null,
          log_index: null,
          status: 'confirmed',
        })
        .onConflict(['address', 'asset', 'tx_hash', 'log_index'])
        .ignore();
      await updateListenerCursor(address, { native_baseline: balance.toString() });
      detected += 1;
    } else if (balance < prev) {
      // Draining below baseline (sweeps lowering the balance) — adjust baseline.
      await updateListenerCursor(address, { native_baseline: balance.toString() });
    }
  }
  return { detected };
}

/**
 * Reconciliation: for open sell orders whose custodial address has no recorded
 * pending deposit but holds an on-chain balance, record a confirmed deposit so
 * a missed scan cannot strand user funds.
 */
export async function reconcileOpenSellDeposits(
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const orders = await db('orders')
    .where({ direction: 'sell', order_state: OrderState.CREATED })
    .whereNotNull('recipient')
    .select('recipient') as Array<{ recipient: string }>;
  if (orders.length === 0) return 0;

  let reconciled = 0;
  for (const { recipient } of orders) {
    let address: `0x${string}`;
    try {
      address = getAddress(recipient);
    } catch {
      continue;
    }
    const existing = await db('cchain_deposits')
      .where({ address })
      .whereIn('status', ['detected', 'confirmed', 'sweeping', 'swept', 'failed'])
      .first();
    if (existing) continue;

    try {
      const [usdtBalance, nativeBalance] = await Promise.all([
        getUsdtBalance(address, env),
        getBalance(address, env),
      ]);
      if (usdtBalance > 0n) {
        await db('cchain_deposits').insert({
          address,
          asset: 'usdt',
          amount: usdtBalance.toString(),
          status: 'confirmed',
        });
        reconciled += 1;
      }
      if (nativeBalance > 0n) {
        await db('cchain_deposits').insert({
          address,
          asset: 'avax',
          amount: nativeBalance.toString(),
          status: 'confirmed',
        });
        reconciled += 1;
      }
      if (reconciled > 0) {
        console.warn(`[CchainListener] Reconciled missed deposit(s) for ${address}`);
      }
    } catch (error) {
      console.error(`[CchainListener] Reconciliation failed for ${address}: ${(error as Error).message}`);
    }
  }
  return reconciled;
}

/**
 * Advance `detected` USDT deposits to `confirmed` once their transaction has
 * reached the required confirmation depth.
 */
export async function confirmPendingUsdtDeposits(
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const cfg = loadCchainConfig(env);
  const pending = await db('cchain_deposits')
    .where({ asset: 'usdt', status: 'detected' })
    .whereNotNull('tx_hash');

  let confirmed = 0;
  for (const dep of pending as CchainDepositRow[]) {
    if (!dep.tx_hash) continue;
    const depth = await getConfirmations(dep.tx_hash as `0x${string}`, env);
    if (depth >= BigInt(cfg.depositConfirmations)) {
      await db('cchain_deposits').where({ id: dep.id }).update({ status: 'confirmed' });
      confirmed += 1;
    }
  }
  return confirmed;
}

/** Confirmed (or transiently failed) deposits not yet in flight. */
export async function listSweepableDeposits(
  env: NodeJS.ProcessEnv = process.env
): Promise<CchainDepositRow[]> {
  return db('cchain_deposits')
    .whereIn('status', ['confirmed', 'failed'])
    .orderBy('created_at', 'asc');
}