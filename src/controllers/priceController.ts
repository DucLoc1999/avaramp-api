import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRate, getMinFee } from '../services/priceService';

export async function handleGetRate(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const rate = await getRate('USDC');
  const minFee = await getMinFee('USDC');
  const partner = req.partner;
  const partnerFeeBuy = partner?.fee_buy ?? 0;
  const partnerFeeSell = partner?.fee_sell ?? 0;

  reply.send({
    created_at: rate.updated_at,
    buy: rate.buy_price,
    sell: rate.sell_price,
    fee_rate_buy: rate.fee_rate_buy + partnerFeeBuy,
    fee_rate_sell: rate.fee_rate_sell + partnerFeeSell,
    min_fee_vnd: minFee,
  });
}

export async function handleGetXlmRate(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const rate = await getRate('XLM');
  const minFee = await getMinFee('XLM');
  const partner = req.partner;
  const partnerFeeBuy = partner?.fee_buy ?? 0;
  const partnerFeeSell = partner?.fee_sell ?? 0;

  reply.send({
    created_at: rate.updated_at,
    buy: rate.buy_price,
    sell: rate.sell_price,
    fee_rate_buy: rate.fee_rate_buy + partnerFeeBuy,
    fee_rate_sell: rate.fee_rate_sell + partnerFeeSell,
    min_fee_vnd: minFee,
  });
}