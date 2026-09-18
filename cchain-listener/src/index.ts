import 'dotenv/config';

const stdout = process.stdout as unknown as { _handle?: { setBlocking: (b: boolean) => void } };
const stderr = process.stderr as unknown as { _handle?: { setBlocking: (b: boolean) => void } };
if (stdout._handle && typeof stdout._handle.setBlocking === 'function') stdout._handle.setBlocking(true);
if (stderr._handle && typeof stderr._handle.setBlocking === 'function') stderr._handle.setBlocking(true);

import { loadCchainConfig } from '../../src/config/cchain';
import {
  scanCchainDeposits,
  scanCchainNativeBalances,
  confirmPendingUsdtDeposits,
  listSweepableDeposits,
  reconcileOpenSellDeposits,
} from '../../src/services/cchainListenerService';
import { emitCchainDeposit } from '../../src/services/cchainEmitService';
import type { CchainDepositRow } from '../../src/services/cchainListenerService';

let pollTimer: NodeJS.Timeout | null = null;
let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOnce(): Promise<{ detected: number; swept: number }> {
  let detected = 0;
  let swept = 0;

  try {
    const usdt = await scanCchainDeposits();
    const native = await scanCchainNativeBalances();
    detected += usdt.detected + native.detected;

    const confirmed = await confirmPendingUsdtDeposits();
    if (confirmed > 0) console.log(`[CchainListener] Confirmed ${confirmed} USDT deposit(s)`);

    const reconciled = await reconcileOpenSellDeposits();
    if (reconciled > 0) console.log(`[CchainListener] Reconciled ${reconciled} missed deposit(s)`);

    const sweepable = await listSweepableDeposits();
    for (const deposit of sweepable as CchainDepositRow[]) {
      console.log(
        `[CchainListener] Emitting sweepable deposit ${deposit.id} (${deposit.asset}, ${deposit.amount}) to ${deposit.address}`
      );
      await emitCchainDeposit({
        depositId: deposit.id,
        address: deposit.address,
        asset: deposit.asset,
        amount: deposit.amount,
        orderId: deposit.order_id,
        txHash: deposit.tx_hash,
      });
      swept += 1;
    }
  } catch (error) {
    console.error('[CchainListener] Poll error:', (error as Error).message);
  }

  return { detected, swept };
}

async function main(): Promise<void> {
  console.log('[CchainListener] Starting...');
  let config;
  try {
    config = loadCchainConfig();
  } catch (error) {
    console.error('[CchainListener] Config error:', (error as Error).message);
    process.exit(1);
  }

  console.log(
    `[CchainListener] RPC: ${config.rpcBaseUrl}, chainId: ${config.chainId}, USDT: ${config.nativeUsdtAddress}`
  );

  const runPoll = async (): Promise<void> => {
    await pollOnce();
  };

  await runPoll();
  pollTimer = setInterval(runPoll, config.pollIntervalMs);
  console.log(`[CchainListener] Listener started, polling every ${config.pollIntervalMs}ms...`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[CchainListener] ${signal} received, shutting down gracefully...`);
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep alive.
  while (running) {
    await sleep(1000);
  }
}

void main();