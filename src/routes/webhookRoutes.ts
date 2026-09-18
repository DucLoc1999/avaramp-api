import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sepayAuth } from '../middlewares/sepayAuth';
import { cchainAuth } from '../middlewares/cchainAuth';
import { sepayPgIpnAuth } from '../middlewares/sepayPgIpnAuth';
import type { SepayWebhookPayload, SepayPgIpnPayload } from '../models/types';
import { handleSepayWebhook, handleSepayPgIpn } from '../controllers/webhookController';
import { handleCchainIncoming } from '../controllers/webhookController';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SepayWebhookPayload }>('/sepay', {
    preHandler: sepayAuth,
    schema: {
      tags: ['Webhooks'],
      summary: 'SePay bank transaction webhook — receives deposit notifications',
      security: [{ SepayWebhookKey: [] }],
      body: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Transaction ID on SePay' },
          gateway: { type: 'string', description: 'Bank brand name' },
          transactionDate: { type: 'string' },
          accountNumber: { type: 'string' },
          code: { type: 'string', nullable: true, description: 'Payment code detected by SePay' },
          content: { type: 'string', description: 'Transfer description' },
          transferType: { type: 'string', enum: ['in', 'out'] },
          transferAmount: { type: 'integer', description: 'Amount in VND' },
          accumulated: { type: 'integer' },
          subAccount: { type: 'string', nullable: true },
          referenceCode: { type: 'string' },
          description: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  }, (req, reply) => handleSepayWebhook(req, reply, app));

  app.post<{ Body: CchainIncomingBody }>('/cchain-incoming', {
    preHandler: cchainAuth,
    schema: {
      tags: ['Webhooks'],
      summary: 'C-Chain incoming webhook — fallback when Kafka unavailable (custodial sweep)',
      body: {
        type: 'object',
        required: ['address', 'asset', 'amount'],
        properties: {
          depositId: { type: 'integer' },
          address: { type: 'string' },
          asset: { type: 'string', enum: ['avax', 'usdt'] },
          amount: { type: 'string' },
          txHash: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        400: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'object' } } },
        401: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } },
      },
    },
  }, handleCchainIncoming);

  app.post<{ Body: SepayPgIpnPayload }>('/sepay-ipn', {
    preHandler: sepayPgIpnAuth,
    schema: {
      tags: ['Webhooks'],
      summary: 'SePay Payment Gateway IPN — receives card/e-wallet payment notifications',
      body: {
        type: 'object',
        required: ['timestamp', 'notification_type', 'order', 'transaction'],
        properties: {
          timestamp: { type: 'integer' },
          notification_type: { type: 'string', enum: ['ORDER_PAID', 'TRANSACTION_VOID'] },
          order: {
            type: 'object',
            required: ['order_invoice_number'],
            properties: {
              id: { type: 'string' },
              order_id: { type: 'string' },
              order_status: { type: 'string' },
              order_currency: { type: 'string' },
              order_amount: { type: 'string' },
              order_invoice_number: { type: 'string', description: 'Maps to payment_code (DH...)' },
              custom_data: { type: 'array' },
              user_agent: { type: 'string' },
              ip_address: { type: 'string' },
              order_description: { type: 'string' },
            },
          },
          transaction: {
            type: 'object',
            required: ['transaction_id', 'transaction_status', 'transaction_amount'],
            properties: {
              id: { type: 'string' },
              payment_method: { type: 'string' },
              transaction_id: { type: 'string' },
              transaction_type: { type: 'string' },
              transaction_date: { type: 'string' },
              transaction_status: { type: 'string', enum: ['APPROVED', 'DECLINED'] },
              transaction_amount: { type: 'string' },
              transaction_currency: { type: 'string' },
            },
          },
          customer: {
            anyOf: [
              { type: 'object', properties: { id: { type: 'string' }, customer_id: { type: 'string' } } },
              { type: 'null' },
            ],
          },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        400: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } },
        401: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' } } },
      },
    },
  }, (req, reply) => handleSepayPgIpn(req, reply, app));
}

interface CchainIncomingBody {
  depositId?: number;
  address: string;
  asset: 'avax' | 'usdt';
  amount: string;
  txHash?: string;
}
