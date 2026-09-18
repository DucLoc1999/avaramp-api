import type { FastifyRequest, FastifyReply } from 'fastify';
import db from '../db';
import { verifyAdminCredentials } from '../services/adminService';
import { signJwt } from '../utils/jwt';
import { createErrorReply } from '../middlewares/errorHandler';
import { OrderState } from '../models/types';

const ACCESS_TOKEN_TTL_SEC = Number(process.env.ADMIN_JWT_TTL_SEC ?? 60 * 60 * 12); // 12h

export async function handleLogin(
  req: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    reply.code(503).send({ success: false, error: 'Admin auth not configured' });
    return;
  }

  const { email, password } = req.body ?? ({} as any);
  if (!email || !password) {
    reply.code(400).send({ success: false, error: 'Missing email or password' });
    return;
  }

  const admin = await verifyAdminCredentials(email, password);
  if (!admin) {
    reply.code(401).send({ success: false, error: 'Invalid credentials' });
    return;
  }

  const access_token = signJwt({ sub: admin.id, email: admin.email }, secret, ACCESS_TOKEN_TTL_SEC);
  reply.send({
    success: true,
    data: {
      access_token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
    },
  });
}

export async function handleGetStats(
  req: FastifyRequest<{ Querystring: { from?: string; to?: string } }>,
  reply: FastifyReply,
) {
  const from = req.query?.from ? new Date(req.query.from) : undefined;
  const to = req.query?.to ? new Date(req.query.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    reply.code(400).send({ success: false, error: 'Invalid from/to date' });
    return;
  }

  const rows = await db('orders')
    .whereIn('order_state', [OrderState.PROCESSING, OrderState.COMPLETED, OrderState.FAILED])
    .whereNotNull('payment_confirmed_at')
    .modify((qb) => {
      if (from) qb.andWhere('payment_confirmed_at', '>=', from);
      if (to) qb.andWhere('payment_confirmed_at', '<=', to);
    })
    .select('direction')
    .count('* as count')
    .sum('net_vnd as net_vnd')
    .sum('fee_vnd as fee_vnd')
    .sum('usdt_amount as usdt_amount')
    .groupBy('direction');

  const byDirection: Record<string, unknown> = {};
  let totalCount = 0;
  let totalNetVnd = 0;
  let totalFeeVnd = 0;
  let totalUsdt = 0;

  for (const r of rows as any[]) {
    const count = Number(r.count ?? 0);
    const net_vnd = Number(r.net_vnd ?? 0);
    const fee_vnd = Number(r.fee_vnd ?? 0);
    const usdt_amount = Number(r.usdt_amount ?? 0);
    totalCount += count;
    totalNetVnd += net_vnd;
    totalFeeVnd += fee_vnd;
    totalUsdt += usdt_amount;
byDirection[String(r.direction)] = { count, net_vnd, fee_vnd, usdt_amount };
  }

  reply.send({
    success: true,
    data: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      totals: {
        count: totalCount,
        net_vnd: totalNetVnd,
        fee_vnd: totalFeeVnd,
        usdt_amount: totalUsdt,
      },
      by_direction: byDirection,
    },
  });
}

export async function handleRotateCallbackSecret(
  req: FastifyRequest<{ Body: { secret: string } }>,
  reply: FastifyReply,
) {
  const { secret } = req.body ?? ({} as any);

  if (!secret || typeof secret !== 'string') {
    return createErrorReply(reply, 'VALIDATION_ERROR', 'Secret is required', req.id);
  }

  if (secret.length < 32) {
    return createErrorReply(reply, 'VALIDATION_ERROR', 'Secret must be at least 32 characters', req.id);
  }

  const now = new Date();
  const existing = await db('config').where({ key: 'callback_secret_rotated_at' }).first();

  if (existing) {
    const rotatedAt = new Date(existing.value);
    const windowMs = 5 * 60 * 1000;
    if (now.getTime() - rotatedAt.getTime() < windowMs) {
      return createErrorReply(reply, 'VALIDATION_ERROR', 'Rotation already in progress. Wait 5 minutes.', req.id);
    }

    await db('config').where({ key: 'callback_secret_previous' }).update({ value: existing.value });
  }

  await db('config')
    .insert({
      key: 'callback_secret_current',
      value: secret,
    })
    .onConflict('key')
    .merge();

  await db('config')
    .insert({
      key: 'callback_secret_previous',
      value: existing?.value || secret,
    })
    .onConflict('key')
    .merge();

  await db('config')
    .insert({
      key: 'callback_secret_rotated_at',
      value: now.toISOString(),
    })
    .onConflict('key')
    .merge();

  return reply.send({ success: true, data: { rotated_at: now.toISOString() } });
}
