import type { FastifyRequest, FastifyReply } from 'fastify';
import { getAllConfig, getAllTokenConfigs, updateConfig, upsertTokenConfig } from '../services/configService';

const GLOBAL_DEFAULTS = {
  spread_buy: 50,
  spread_sell: 50,
  fee_rate_buy: 0.008,
  fee_rate_sell: 0.008,
  usdc_min_fee: 5000,
  xlm_min_fee: 5000,
};

async function buildConfigSnapshot() {
  const [flatConfig, tokenConfigs] = await Promise.all([getAllConfig(), getAllTokenConfigs()]);
  const usdcBuy = tokenConfigs['USDC']?.buy;
  const usdcSell = tokenConfigs['USDC']?.sell;
  const xlmBuy = tokenConfigs['XLM']?.buy;
  const xlmSell = tokenConfigs['XLM']?.sell;

  const num = (key: keyof typeof GLOBAL_DEFAULTS) => {
    const value = flatConfig[key];
    const parsed = value !== undefined ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : GLOBAL_DEFAULTS[key];
  };

  return {
    spread_buy: num('spread_buy'),
    spread_sell: num('spread_sell'),
    fee_rate_buy: num('fee_rate_buy'),
    fee_rate_sell: num('fee_rate_sell'),
    usdc_min_fee: num('usdc_min_fee'),
    xlm_min_fee: num('xlm_min_fee'),
    usdc_spread_buy: usdcBuy?.spread ?? 50,
    usdc_spread_sell: usdcSell?.spread ?? 50,
    usdc_fee_rate_buy: usdcBuy?.fee_rate ?? 0.008,
    usdc_fee_rate_sell: usdcSell?.fee_rate ?? 0.008,
    usdc_min_order_amount: usdcBuy?.min_order_amount ?? 1,
    usdc_source_buy: usdcBuy?.source,
    usdc_source_sell: usdcSell?.source,
    xlm_spread_buy: xlmBuy?.spread ?? 50,
    xlm_spread_sell: xlmSell?.spread ?? 50,
    xlm_fee_rate_buy: xlmBuy?.fee_rate ?? 0.008,
    xlm_fee_rate_sell: xlmSell?.fee_rate ?? 0.008,
    xlm_min_order_amount: xlmBuy?.min_order_amount ?? 1,
    xlm_source_buy: xlmBuy?.source,
    xlm_source_sell: xlmSell?.source,
  };
}

export async function handleGetFees(
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  reply.send({
    success: true,
    data: await buildConfigSnapshot(),
  });
}

export async function handleGetTokenFees(
  req: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
) {
  const token = req.params?.token?.trim().toUpperCase();
  const allTokenConfigs = await getAllTokenConfigs();
  const tokenConfig = token ? allTokenConfigs[token] : undefined;

  if (!token || !tokenConfig) {
    reply.code(404).send({ success: false, error: 'Token config not found' });
    return;
  }

  reply.send({
    success: true,
    data: {
      token,
      buy: tokenConfig.buy,
      sell: tokenConfig.sell,
    },
  });
}

interface TokenSidePatch {
  spread?: number;
  fee_rate?: number;
  min_fee?: number;
  min_order_amount?: number;
  source?: string;
}

interface PatchBody {
  spread_buy?: number;
  spread_sell?: number;
  fee_rate_buy?: number;
  fee_rate_sell?: number;
  usdc_min_fee?: number;
  xlm_min_fee?: number;
  USDC_buy?: TokenSidePatch;
  USDC_sell?: TokenSidePatch;
  XLM_buy?: TokenSidePatch;
  XLM_sell?: TokenSidePatch;
}

export async function handlePatchConfig(
  req: FastifyRequest<{ Body: PatchBody }>,
  reply: FastifyReply,
) {
  const body = req.body ?? {};
  const changedBy = typeof req.admin?.email === 'string' ? req.admin.email : 'admin';

  const updates: Array<Promise<unknown>> = [];

  if (typeof body.spread_buy === 'number') {
    updates.push(updateConfig('spread_buy', String(body.spread_buy), changedBy));
  }
  if (typeof body.spread_sell === 'number') {
    updates.push(updateConfig('spread_sell', String(body.spread_sell), changedBy));
  }
  if (typeof body.fee_rate_buy === 'number') {
    updates.push(updateConfig('fee_rate_buy', String(body.fee_rate_buy), changedBy));
  }
  if (typeof body.fee_rate_sell === 'number') {
    updates.push(updateConfig('fee_rate_sell', String(body.fee_rate_sell), changedBy));
  }
  if (typeof body.usdc_min_fee === 'number') {
    updates.push(updateConfig('usdc_min_fee', String(body.usdc_min_fee), changedBy));
  }
  if (typeof body.xlm_min_fee === 'number') {
    updates.push(updateConfig('xlm_min_fee', String(body.xlm_min_fee), changedBy));
  }

  const tokenSidePairs: Array<[token: string, side: 'buy' | 'sell', patch?: TokenSidePatch]> = [
    ['USDC', 'buy', body.USDC_buy],
    ['USDC', 'sell', body.USDC_sell],
    ['XLM', 'buy', body.XLM_buy],
    ['XLM', 'sell', body.XLM_sell],
  ];

  for (const [token, side, patch] of tokenSidePairs) {
    if (patch && Object.keys(patch).length > 0) {
      updates.push(upsertTokenConfig(token, side, patch, changedBy));
    }
  }

  if (updates.length === 0) {
    reply.code(400).send({ success: false, error: 'No config fields provided' });
    return;
  }

  await Promise.all(updates);

  reply.send({
    success: true,
    data: await buildConfigSnapshot(),
  });
}
