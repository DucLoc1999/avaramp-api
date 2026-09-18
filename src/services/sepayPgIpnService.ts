import db from '../db';
import { confirmPayment } from './orderService';
import { fireCallback } from './callbackService';
import { OrderState } from '../models/types';
import type { SepayPgIpnPayload } from '../models/types';

export async function handleIpn(payload: SepayPgIpnPayload): Promise<void> {
  const { notification_type, order, transaction } = payload;
  if (!order?.order_invoice_number || !transaction?.transaction_id) return;

  const paymentCode = order.order_invoice_number;

  if (notification_type === 'ORDER_PAID') {
    await handleOrderPaid(paymentCode, transaction);
  } else if (notification_type === 'TRANSACTION_VOID') {
    await handleTransactionVoid(paymentCode, transaction);
  }
}

async function handleOrderPaid(
  paymentCode: string,
  transaction: SepayPgIpnPayload['transaction'],
): Promise<void> {
  if (transaction.transaction_status !== 'APPROVED') return;

  const existing = await db('webhook_logs')
    .where({ sepay_transaction_id: transaction.transaction_id })
    .first();
  if (existing) return;

  const dbOrder = await db('orders')
    .where({ payment_code: paymentCode, order_state: OrderState.CREATED })
    .first();
  if (!dbOrder) return;

  const [insertedLog] = await db('webhook_logs').insert({
    sepay_transaction_id: transaction.transaction_id,
    source: 'sepay-pg',
    body: JSON.stringify({ paymentCode, transaction }),
  }).returning('id');
  const webhookLogId = Number((insertedLog as any).id ?? insertedLog);

  const vndReceived = Math.round(parseFloat(transaction.transaction_amount));

  await confirmPayment({
    payment_code: paymentCode,
    vnd_received: vndReceived,
    last_webhook_id: String(webhookLogId),
  });
}

async function handleTransactionVoid(
  paymentCode: string,
  transaction: SepayPgIpnPayload['transaction'],
): Promise<void> {
  const existing = await db('webhook_logs')
    .where({ sepay_transaction_id: transaction.transaction_id, source: 'sepay-ipn' })
    .first();
  if (existing) return;

  const [insertedLog] = await db('webhook_logs').insert({
    sepay_transaction_id: transaction.transaction_id,
    source: 'sepay-ipn',
    body: JSON.stringify({ paymentCode, transaction }),
  }).returning('id');
  const _webhookLogId = Number((insertedLog as any).id ?? insertedLog);

  const dbOrder = await db('orders')
    .where({ payment_code: paymentCode, order_state: OrderState.CREATED })
    .first();
  if (!dbOrder) return;

  const oldState = dbOrder.order_state || 0;
  await db('orders')
    .where({ id: dbOrder.id })
    .update({
      order_state: OrderState.FAILED,
      payment_status: 'failed',
      error_message: `TRANSACTION_VOID: ${transaction.transaction_id}`,
    });

  if (dbOrder.callback) {
    fireCallback(dbOrder.callback, dbOrder.id, oldState, OrderState.FAILED, dbOrder.processing_state || 0, dbOrder.processing_state || 0)
      .catch((err) => console.error('[SepayPgIpn] fireCallback failed:', err));
  }
}
