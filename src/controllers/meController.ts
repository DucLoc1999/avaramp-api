import type { FastifyRequest, FastifyReply } from 'fastify';
import { createErrorReply } from '../middlewares/errorHandler';
import * as userService from '../services/userService';
import * as paymentMethodService from '../services/paymentMethodService';
import * as s3Service from '../services/s3Service';
import * as idRecognitionService from '../services/idRecognitionService';
import { createDepositV2, createWithdrawalV2, formatOrderResponse, listOrders, getOrderById, getOrderByCode } from '../services/orderService';
import type { DepositV2Request, WithdrawalV2Request } from '../models/types';

function formatUserResponse(user: Record<string, unknown>) {
  const { kyc_image_front, kyc_image_back, ...rest } = user;
  return rest;
}

export async function handleGetMe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await userService.findById(req.user!.id);
  if (!user) {
    return createErrorReply(reply, 'USER_NOT_FOUND', 'User not found', req.id);
  }
  return reply.send({ success: true, data: formatUserResponse(user as unknown as Record<string, unknown>) });
}

export async function handleMeKyc(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  let imageFrontBuffer: Buffer | null = null;
  let imageBackBuffer: Buffer | null = null;

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (part.fieldname === 'image_front') {
        imageFrontBuffer = buffer;
      } else if (part.fieldname === 'image_back') {
        imageBackBuffer = buffer;
      }
    }
  }

  if (!imageFrontBuffer || !imageBackBuffer) {
    return createErrorReply(reply, 'VALIDATION_ERROR', 'Both image_front and image_back are required', req.id);
  }

  const timestamp = Date.now();
  const userId = req.user!.id;
  const frontKey = `kyc/${userId}_${timestamp}_front.jpg`;
  const backKey = `kyc/${userId}_${timestamp}_back.jpg`;

  const [frontUrl, backUrl] = await Promise.all([
    s3Service.uploadFile(imageFrontBuffer, frontKey, 'image/jpeg'),
    s3Service.uploadFile(imageBackBuffer, backKey, 'image/jpeg'),
  ]);

  try {
    const [frontData, backData] = await Promise.all([
      idRecognitionService.recognizeIdCard(imageFrontBuffer, 'front'),
      idRecognitionService.recognizeIdCard(imageBackBuffer, 'back'),
    ]);

    const idNumber = frontData.id_number;
    if (!idNumber) {
      return createErrorReply(reply, 'VALIDATION_ERROR', 'Could not extract ID number from front image', req.id);
    }

    const dob = idRecognitionService.parseIsoDate(frontData.date_of_birth);
    if (!dob) {
      return createErrorReply(reply, 'VALIDATION_ERROR', 'Could not parse date of birth from ID card', req.id);
    }

    const doe = idRecognitionService.parseIsoDate(backData.expiry_date || backData.issue_date);

    const updatedUser = await userService.updateKycData(userId, {
      id_number: idNumber,
      name: frontData.full_name || undefined,
      dob,
      sex: frontData.sex || null,
      nationality: frontData.nationality || null,
      home: frontData.home || null,
      address: frontData.address || null,
      doe: doe || null,
      kyc_image_front: frontUrl,
      kyc_image_back: backUrl,
      kyc_status: 'approved',
      kyc_verified_at: new Date(),
    });

    return reply.send({ success: true, data: formatUserResponse(updatedUser as unknown as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof idRecognitionService.NotIdCardError) {
      return createErrorReply(reply, 'VALIDATION_ERROR', err.message, req.id);
    }
    if (err instanceof idRecognitionService.GeminiConfigError) {
      return createErrorReply(reply, 'AUTH_NOT_CONFIGURED', err.message, req.id);
    }
    throw err;
  }
}

export async function handleListMePaymentMethods(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const methods = await paymentMethodService.listByUserId(req.user!.id);
  return reply.send({ success: true, data: methods });
}

export async function handleAddMePaymentMethod(
  req: FastifyRequest<{ Body: paymentMethodService.CreatePaymentMethodInput }>,
  reply: FastifyReply,
): Promise<void> {
  const method = await paymentMethodService.create(req.user!.id, req.body);
  return reply.status(201).send({ success: true, data: method });
}

export async function handleUpdateMePaymentMethod(
  req: FastifyRequest<{ Params: { id: string }; Body: paymentMethodService.UpdatePaymentMethodInput }>,
  reply: FastifyReply,
): Promise<void> {
  const paymentId = Number(req.params.id);
  const existing = await paymentMethodService.findById(paymentId);
  if (!existing || existing.user_id !== req.user!.id) {
    return createErrorReply(reply, 'PAYMENT_METHOD_NOT_FOUND', 'Payment method not found', req.id);
  }
  const updated = await paymentMethodService.update(paymentId, req.body);
  return reply.send({ success: true, data: updated });
}

export async function handleDeleteMePaymentMethod(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const paymentId = Number(req.params.id);
  const existing = await paymentMethodService.findById(paymentId);
  if (!existing || existing.user_id !== req.user!.id) {
    return createErrorReply(reply, 'PAYMENT_METHOD_NOT_FOUND', 'Payment method not found', req.id);
  }
  await paymentMethodService.remove(paymentId);
  return reply.send({ success: true, data: { id: paymentId, deleted: true } });
}

export interface MeDepositBody {
  amount: string;
  chain_id: number;
  token_address?: string;
  asset_code: string;
  payment_method_id: number;
  pay_gateway?: 'bank' | 'napas';
  callback?: string;
}

export async function handleMeDeposit(
  req: FastifyRequest<{ Body: MeDepositBody }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }

  const depositReq: DepositV2Request = {
    amount: req.body.amount,
    chain_id: req.body.chain_id,
    token_address: req.body.token_address,
    asset_code: req.body.asset_code,
    callback: req.body.callback || '',
    user_id: req.user!.id,
    payment_method_id: req.body.payment_method_id,
    pay_gateway: req.body.pay_gateway,
  };

  try {
    const data = await createDepositV2(depositReq, { clientIp: req.ip });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const knownErrors: Record<string, string> = {
      USER_NOT_FOUND: 'User not found',
      PAYMENT_METHOD_NOT_FOUND: 'Payment method not found or does not belong to user',
      PAYMENT_METHOD_TYPE_MISMATCH: 'Payment method must be of type CRYPTO for deposit',
      PAYMENT_METHOD_MISSING_WALLET: 'Payment method has no wallet address configured',
      RECIPIENT_INVALID_ADDRESS: 'Recipient is not a valid X-Chain bech32 address (X-avax1…)',
      UNSUPPORTED_TOKEN: 'Token address not supported',
      MIN_ORDER_NOT_MET: 'Order amount is below the minimum allowed limit',
      MAX_ORDER_EXCEEDED: 'Order amount exceeds the maximum allowed limit',
      INSUFFICIENT_LIQUIDITY: 'Insufficient available liquidity for this order',
      RESERVATION_NOT_READY: 'Liquidity reservation service is not ready',
    };
    if (errMsg in knownErrors) {
      return createErrorReply(reply, errMsg, knownErrors[errMsg], req.id);
    }
    throw error;
  }
}

export interface MeWithdrawBody {
  amount: string;
  chain_id: number;
  token_address?: string;
  asset_code: string;
  payment_method_id: number;
  callback?: string;
}

export async function handleMeWithdraw(
  req: FastifyRequest<{ Body: MeWithdrawBody }>,
  reply: FastifyReply,
): Promise<void> {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) {
    return createErrorReply(reply, 'INVALID_AMOUNT', 'Amount must be a positive number', req.id);
  }

  const withdrawReq: WithdrawalV2Request = {
    amount: req.body.amount,
    chain_id: req.body.chain_id,
    token_address: req.body.token_address,
    asset_code: req.body.asset_code,
    callback: req.body.callback || '',
    user_id: req.user!.id,
    payment_method_id: req.body.payment_method_id,
  };

  try {
    const data = await createWithdrawalV2(withdrawReq, { clientIp: req.ip });
    return reply.send({ success: true, data });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const knownErrors: Record<string, string> = {
      USER_NOT_FOUND: 'User not found',
      PAYMENT_METHOD_NOT_FOUND: 'Payment method not found or does not belong to user',
      PAYMENT_METHOD_TYPE_MISMATCH: 'Payment method must be of type BANK for withdrawal',
      PAYMENT_METHOD_MISSING_BANK_INFO: 'Payment method is missing required bank information',
      UNSUPPORTED_TOKEN: 'Token address not supported',
      MIN_ORDER_NOT_MET: 'Order amount is below the minimum allowed limit',
      MAX_ORDER_EXCEEDED: 'Order amount exceeds the maximum allowed limit',
      INSUFFICIENT_LIQUIDITY: 'Insufficient available liquidity for this order',
      RESERVATION_NOT_READY: 'Liquidity reservation service is not ready',
    };
    if (errMsg in knownErrors) {
      return createErrorReply(reply, errMsg, knownErrors[errMsg], req.id);
    }
    throw error;
  }
}

export async function handleListMeOrders(
  req: FastifyRequest<{ Querystring: { limit?: string; offset?: string; direction?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
  const direction = (['buy', 'sell'] as const).includes(req.query.direction as 'buy' | 'sell')
    ? (req.query.direction as 'buy' | 'sell')
    : undefined;

  const orders = await listOrders({ userId: req.user!.id, limit, offset, direction });
  const data = await Promise.all(orders.map(formatOrderResponse));
  return reply.send({ success: true, data });
}

export async function handleGetMeOrder(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const param = req.params.id.trim();
  const numeric = Number(param);
  let order = null;

  if (Number.isInteger(numeric) && String(numeric) === param) {
    order = await getOrderById(numeric);
  }
  if (!order) {
    order = await getOrderByCode(param);
  }
  if (!order && Number.isInteger(numeric)) {
    order = await getOrderById(numeric);
  }

  if (!order) {
    return createErrorReply(reply, 'ORDER_NOT_FOUND', 'Order not found', req.id);
  }

  // Ensure the order belongs to this user
  const orderUserId = (order as any).user_id;
  if (orderUserId != null && Number(orderUserId) !== req.user!.id) {
    return createErrorReply(reply, 'ORDER_NOT_FOUND', 'Order not found', req.id);
  }

  const data = await formatOrderResponse(order);
  return reply.send({ success: true, data });
}
