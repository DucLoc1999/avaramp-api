import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createDeposit,
  createWithdrawal,
  createDepositV2,
  createWithdrawalV2,
  getOrderById,
  getOrderByCode,
  cancelOrder,
  formatOrderResponse,
  listOrders,
} from '../services/orderService';
import type { DepositRequest, WithdrawalRequest, DepositV2Request, WithdrawalV2Request } from '../models/types';
import { createErrorReply } from '../middlewares/errorHandler';

async function resolveOrderByParam(id: string) {
  const trimmed = id.trim();
  const numeric = Number(trimmed);

  if (Number.isInteger(numeric) && String(numeric) === trimmed) {
    const byId = await getOrderById(numeric);
    if (byId) return byId;
  }

  const byCode = await getOrderByCode(trimmed);
  if (byCode) return byCode;

  if (Number.isInteger(numeric)) {
    return await getOrderById(numeric);
  }

  return null;
}

export async function handleDeposit(
  req: FastifyRequest<{ Body: DepositRequest }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }
  try {
    const data = await createDeposit(req.body, { clientIp: req.ip, partner: req.partner });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg === 'RECIPIENT_INVALID_ADDRESS') {
      return createErrorReply(reply, 'RECIPIENT_INVALID_ADDRESS', 'Recipient is not a valid Avalanche C-Chain (EVM) 0x address', req.id);
    }
    if (errMsg === 'UNSUPPORTED_TOKEN') {
      return createErrorReply(reply, 'UNSUPPORTED_TOKEN', 'Token address not supported', req.id);
    }
    if (errMsg === 'MIN_ORDER_NOT_MET') {
      return createErrorReply(reply, 'MIN_ORDER_NOT_MET', 'Order amount is below the minimum allowed limit', req.id);
    }
    if (errMsg === 'INSUFFICIENT_LIQUIDITY') {
      return createErrorReply(reply, 'INSUFFICIENT_LIQUIDITY', 'Insufficient available liquidity for this order', req.id);
    }
    if (errMsg === 'RESERVATION_NOT_READY') {
      return createErrorReply(reply, 'RESERVATION_NOT_READY', 'Liquidity reservation service is not ready', req.id);
    }
    if (errMsg === 'MAX_ORDER_EXCEEDED') {
      return createErrorReply(reply, 'MAX_ORDER_EXCEEDED', 'Order amount exceeds the maximum allowed limit', req.id);
    }
    throw error;
  }
}

export async function handleWithdrawal(
  req: FastifyRequest<{ Body: WithdrawalRequest }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }
  try {
    const data = await createWithdrawal(req.body, { clientIp: req.ip, partner: req.partner });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg === 'MIN_ORDER_NOT_MET') {
      return createErrorReply(reply, 'MIN_ORDER_NOT_MET', 'Order amount is below the minimum allowed limit', req.id);
    }
    if (errMsg === 'INSUFFICIENT_LIQUIDITY') {
      return createErrorReply(reply, 'INSUFFICIENT_LIQUIDITY', 'Insufficient available liquidity for this order', req.id);
    }
    if (errMsg === 'RESERVATION_NOT_READY') {
      return createErrorReply(reply, 'RESERVATION_NOT_READY', 'Liquidity reservation service is not ready', req.id);
    }
    if (errMsg === 'MAX_ORDER_EXCEEDED') {
      return createErrorReply(reply, 'MAX_ORDER_EXCEEDED', 'Order amount exceeds the maximum allowed limit', req.id);
    }
    throw error;
  }
}

export async function handleListOrders(
  req: FastifyRequest<{ Querystring: { limit?: string; offset?: string; direction?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const direction = (['buy', 'sell'] as const).includes(req.query.direction as any)
    ? (req.query.direction as 'buy' | 'sell')
    : undefined;
  const orders = await listOrders({ partnerId: req.partner?.id, limit, offset, direction });
  const data = orders.map((o) => ({
    payment_code: o.payment_code,
    transaction_hash: o.transaction_hash,
    order_state: o.order_state,
    direction: o.direction,
    usdt_amount: typeof o.usdt_amount === 'string' ? parseFloat(o.usdt_amount) : o.usdt_amount,
    asset_code: o.asset_code,
    net_vnd: typeof o.net_vnd === 'string' ? Number(o.net_vnd) : o.net_vnd,
    fee_vnd: typeof o.fee_vnd === 'string' ? Number(o.fee_vnd) : o.fee_vnd,
    rate: typeof o.rate === 'string' ? Number(o.rate) : o.rate,
    created_at: o.created_at,
    updated_at: o.updated_at,
  }));
  return reply.send({ success: true, data });
}

export async function handleGetOrder(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const order = await resolveOrderByParam(req.params.id);
  if (!order) {
    return createErrorReply(reply, 'ORDER_NOT_FOUND', 'Order not found', req.id);
  }
  const data = await formatOrderResponse(order);
  return reply.send({ success: true, data });
}

export async function handleCancel(
  req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const order = await resolveOrderByParam(req.params.id);
  if (!order) {
    return createErrorReply(reply, 'ORDER_NOT_FOUND', 'Order not found', req.id);
  }

  const result = await cancelOrder(order.payment_code, req.body?.reason);

  if (result.error) {
    const errorCode = result.error === 'ORDER_NOT_FOUND' ? 'ORDER_NOT_FOUND' :
                      result.error === 'CANCEL_NOT_ALLOWED' ? 'CANCEL_NOT_ALLOWED' :
                      'INTERNAL_ERROR';
    return createErrorReply(reply, errorCode, result.error, req.id);
  }

  return reply.send({ success: true, data: result.data });
}

export async function handleOrderSuccess(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const order = await resolveOrderByParam(req.params.id);
  const paymentCode = order?.payment_code || req.params.id;
  const url = `${process.env.DOMAIN || ''}/order/${paymentCode}?payment=success`;
  return reply.redirect(url, 302);
}

export async function handleOrderError(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const order = await resolveOrderByParam(req.params.id);
  const paymentCode = order?.payment_code || req.params.id;
  const url = `${process.env.DOMAIN || ''}/order/${paymentCode}?payment=error`;
  return reply.redirect(url, 302);
}

export async function handleOrderCancel(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const order = await resolveOrderByParam(req.params.id);
  const paymentCode = order?.payment_code || req.params.id;
  const url = `${process.env.DOMAIN || ''}/order/${paymentCode}?payment=cancel`;
  return reply.redirect(url, 302);
}

export async function handleDepositV2(
  req: FastifyRequest<{ Body: DepositV2Request }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }
  try {
    const data = await createDepositV2(req.body, { clientIp: req.ip, partner: req.partner });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg === 'USER_NOT_FOUND') {
      return createErrorReply(reply, 'USER_NOT_FOUND', 'User not found', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_NOT_FOUND') {
      return createErrorReply(reply, 'PAYMENT_METHOD_NOT_FOUND', 'Payment method not found or does not belong to user', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_TYPE_MISMATCH') {
      return createErrorReply(reply, 'PAYMENT_METHOD_TYPE_MISMATCH', 'Payment method must be of type CRYPTO for deposit', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_MISSING_WALLET') {
      return createErrorReply(reply, 'PAYMENT_METHOD_MISSING_WALLET', 'Payment method has no wallet address configured', req.id);
    }
    if (errMsg === 'RECIPIENT_INVALID_ADDRESS') {
      return createErrorReply(reply, 'RECIPIENT_INVALID_ADDRESS', 'Recipient is not a valid Avalanche C-Chain (EVM) 0x address', req.id);
    }
    if (errMsg === 'UNSUPPORTED_TOKEN') {
      return createErrorReply(reply, 'UNSUPPORTED_TOKEN', 'Token address not supported', req.id);
    }
    if (errMsg === 'MIN_ORDER_NOT_MET') {
      return createErrorReply(reply, 'MIN_ORDER_NOT_MET', 'Order amount is below the minimum allowed limit', req.id);
    }
    if (errMsg === 'INSUFFICIENT_LIQUIDITY') {
      return createErrorReply(reply, 'INSUFFICIENT_LIQUIDITY', 'Insufficient available liquidity for this order', req.id);
    }
    if (errMsg === 'RESERVATION_NOT_READY') {
      return createErrorReply(reply, 'RESERVATION_NOT_READY', 'Liquidity reservation service is not ready', req.id);
    }
    if (errMsg === 'MAX_ORDER_EXCEEDED') {
      return createErrorReply(reply, 'MAX_ORDER_EXCEEDED', 'Order amount exceeds the maximum allowed limit', req.id);
    }
    throw error;
  }
}

export async function handleWithdrawalV2(
  req: FastifyRequest<{ Body: WithdrawalV2Request }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }
  try {
    const data = await createWithdrawalV2(req.body, { clientIp: req.ip, partner: req.partner });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg === 'USER_NOT_FOUND') {
      return createErrorReply(reply, 'USER_NOT_FOUND', 'User not found', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_NOT_FOUND') {
      return createErrorReply(reply, 'PAYMENT_METHOD_NOT_FOUND', 'Payment method not found or does not belong to user', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_TYPE_MISMATCH') {
      return createErrorReply(reply, 'PAYMENT_METHOD_TYPE_MISMATCH', 'Payment method must be of type BANK for withdrawal', req.id);
    }
    if (errMsg === 'PAYMENT_METHOD_MISSING_BANK_INFO') {
      return createErrorReply(reply, 'PAYMENT_METHOD_MISSING_BANK_INFO', 'Payment method is missing required bank information', req.id);
    }
    if (errMsg === 'UNSUPPORTED_TOKEN') {
      return createErrorReply(reply, 'UNSUPPORTED_TOKEN', 'Token address not supported', req.id);
    }
    if (errMsg === 'INSUFFICIENT_LIQUIDITY') {
      return createErrorReply(reply, 'INSUFFICIENT_LIQUIDITY', 'Insufficient available liquidity for this order', req.id);
    }
    if (errMsg === 'RESERVATION_NOT_READY') {
      return createErrorReply(reply, 'RESERVATION_NOT_READY', 'Liquidity reservation service is not ready', req.id);
    }
    if (errMsg === 'MAX_ORDER_EXCEEDED') {
      return createErrorReply(reply, 'MAX_ORDER_EXCEEDED', 'Order amount exceeds the maximum allowed limit', req.id);
    }
    throw error;
  }
}
