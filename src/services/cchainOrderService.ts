import { getAddress } from 'viem';
import db from '../db';
import { OrderState, ProcessingState } from '../models/types';
import { fireCallback } from './callbackService';
import { emitOrderPaid } from './queueService';
import { updateCustodialSwept, getOrderByCustodialAddress } from './cchainPersistence';
import { sweepNativeAvax, sweepUsdt } from './cchainSweepService';
import { CchainDepositEvent } from './cchainEmitServiceTypes';

/**
 * Handle a confirmed C-Chain deposit for a custodial address: sweep the funds to
 * the Master Wallet, mark the deposit swept, and if it belongs to an open sell
 * order, complete that order exactly once.
 */
export async function notifyCchainDeposit(
  event: CchainDepositEvent,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ swept: boolean; completed: boolean; error?: string }> {
  const address = getAddress(event.address);

  // Idempotency: never re-sweep a deposit already marked swept.
  const deposit = await db('cchain_deposits').where({ id: event.depositId }).first();
  if (!deposit) return { swept: false, completed: false, error: 'DEPOSIT_NOT_FOUND' };
  if (deposit.status === 'swept') return { swept: false, completed: false };

  // 1) Sweep.
  await db('cchain_deposits').where({ id: event.depositId }).update({ status: 'sweeping' });
  const sweepResult =
    event.asset === 'usdt'
      ? await sweepUsdt(address, BigInt(event.amount), env)
      : await sweepNativeAvax(address, env);

  if (!sweepResult.success) {
    await db('cchain_deposits').where({ id: event.depositId }).update({ status: 'failed' });
    return { swept: false, completed: false, error: sweepResult.error };
  }

  // 2) Mark swept.
  let orderId: number | null = deposit.order_id ?? null;
  await db('cchain_deposits')
    .where({ id: event.depositId })
    .update({ status: 'swept', sweep_tx_hash: sweepResult.txHash ?? null });

  if (event.asset === 'usdt') {
    await updateCustodialSwept(address, { swept_navax_block: null, swept_usdt_txhash: sweepResult.txHash ?? null });
  } else {
    await updateCustodialSwept(address, { swept_navax_block: sweepResult.txHash ?? null, swept_usdt_txhash: null });
  }

  // 3) Correlate to the owning sell order (recipient = custodial address).
  if (orderId === null) {
    const order = await getOrderByCustodialAddress(address);
    orderId = order?.id ?? null;
  }
  if (orderId === null) {
    // No open order — sweep already preserved funds; log for reconciliation.
    console.warn(`[CchainOrder] Swept deposit ${event.depositId} has no matching sell order (address=${address})`);
    return { swept: true, completed: false };
  }
  await db('cchain_deposits').where({ id: event.depositId }).update({ order_id: orderId });

  // 4) Complete the order once (idempotent).
  const order = await db('orders').where({ id: orderId }).first();
  if (!order) return { swept: true, completed: false, error: 'ORDER_NOT_FOUND' };
  if (order.order_state === OrderState.COMPLETED) {
    return { swept: true, completed: false };
  }

  await db('orders')
    .where({ id: orderId })
    .update({
      order_state: OrderState.COMPLETED,
      processing_state: ProcessingState.SELL_PAYOUT_COMPLETED,
      transaction_hash: sweepResult.txHash ?? null,
    });

  if (order.callback) {
    fireCallback(
      order.callback,
      orderId,
      order.order_state,
      OrderState.COMPLETED,
      order.processing_state ?? 0,
      ProcessingState.SELL_PAYOUT_COMPLETED,
      sweepResult.txHash ?? null
    ).catch((err) => console.error('[CchainOrder] fireCallback failed:', (err as Error).message));
  }
  emitOrderPaid({
    orderId: Number(orderId),
    amount: String(order.usdt_amount),
    txHash: sweepResult.txHash ?? '',
    paymentCode: order.payment_code,
  }).catch((err) => console.error('[CchainOrder] emitOrderPaid failed:', (err as Error).message));

  return { swept: true, completed: true };
}