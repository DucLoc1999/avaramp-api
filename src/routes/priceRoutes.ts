import type { FastifyInstance } from 'fastify';
import { handleGetRate, handleGetXlmRate } from '../controllers/priceController';
import { partnerAuth } from '../middlewares/partnerAuth';

export async function priceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/usdt_vnd', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Price'],
      summary: 'Get live USDC/VND buy and sell rates',
      description: 'Returns our USDC/VND buy and sell rates. Rates are calculated from Binance P2P median price plus configured spread and fee. Cached for 30 seconds. Requires Partner-App-Key auth. Fees include token config fee + partner fee.',
      response: {
        200: {
          type: 'object',
          description: 'Current USDC/VND rates',
          properties: {
            created_at: { type: 'string', description: 'ISO 8601 timestamp when rate was last computed' },
            buy: { type: 'number', description: 'Our buy rate (VND per USDC) — price client pays to buy USDC from us' },
            sell: { type: 'number', description: 'Our sell rate (VND per USDC) — price client receives when selling USDC to us' },
            fee_rate_buy: { type: 'number', description: 'Buy fee rate (e.g. 0.008 = 0.8%). Combined token config fee + partner fee.' },
            fee_rate_sell: { type: 'number', description: 'Sell fee rate (e.g. 0.008 = 0.8%). Combined token config fee + partner fee.' },
            min_fee_vnd: { type: 'number', description: 'Minimum absolute fee in VND (applied when percentage fee < this value)' },
          },
        },
      },
    },
  }, handleGetRate);

  app.get('/xlm_vnd', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Price'],
      summary: 'Get live XLM/VND buy and sell rates',
      description: 'Returns our XLM/VND buy and sell rates. Rates are calculated from Binance P2P median price plus configured spread and fee. Cached for 30 seconds. Requires Partner-App-Key auth. Fees include token config fee + partner fee.',
      response: {
        200: {
          type: 'object',
          description: 'Current XLM/VND rates',
          properties: {
            created_at: { type: 'string', description: 'ISO 8601 timestamp when rate was last computed' },
            buy: { type: 'number', description: 'Our buy rate (VND per XLM) — price client pays to buy XLM from us' },
            sell: { type: 'number', description: 'Our sell rate (VND per XLM) — price client receives when selling XLM to us' },
            fee_rate_buy: { type: 'number', description: 'Buy fee rate (e.g. 0.008 = 0.8%). Combined token config fee + partner fee.' },
            fee_rate_sell: { type: 'number', description: 'Sell fee rate (e.g. 0.008 = 0.8%). Combined token config fee + partner fee.' },
            min_fee_vnd: { type: 'number', description: 'Minimum absolute fee in VND (applied when percentage fee < this value)' },
          },
        },
      },
    },
  }, handleGetXlmRate);
}
