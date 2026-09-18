import db from '../db';

/** Persist sweep bookkeeping on a custodial wallet row. */
export async function updateCustodialSwept(
  address: string,
  patch: { swept_navax_block?: string | null; swept_usdt_txhash?: string | null }
): Promise<void> {
  await db('custodial_wallets').where({ address }).update({ ...patch, updated_at: new Date() });
}

/** Look up a sell order whose `recipient` equals a custodial deposit address. */
export async function getOrderByCustodialAddress(
  address: string
): Promise<{ id: number; callback: string | null; order_state: number; processing_state?: number | null; usdt_amount: string | number; payment_code: string } | null> {
  return db('orders').where({ recipient: address }).orderBy('id', 'asc').first();
}

/** Mark a deposit's status (used by the sweep lifecycle). */
export async function setDepositStatus(
  depositId: number,
  status: string,
  sweepTxHash?: string | null
): Promise<void> {
  await db('cchain_deposits')
    .where({ id: depositId })
    .update({
      status,
      ...(sweepTxHash !== undefined ? { sweep_tx_hash: sweepTxHash } : {}),
      updated_at: new Date(),
    });
}