import type { FastifyInstance } from 'fastify';
import { userAuth } from '../middlewares/userAuth';
import { kycCheck } from '../middlewares/kycCheck';
import type { CreatePaymentMethodInput, UpdatePaymentMethodInput } from '../services/paymentMethodService';
import {
  handleGetMe,
  handleMeKyc,
  handleListMePaymentMethods,
  handleAddMePaymentMethod,
  handleUpdateMePaymentMethod,
  handleDeleteMePaymentMethod,
  handleMeDeposit,
  handleMeWithdraw,
  handleListMeOrders,
  handleGetMeOrder,
  type MeDepositBody,
  type MeWithdrawBody,
} from '../controllers/meController';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Get current user profile',
    },
  }, handleGetMe);

  app.post('/kyc', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Submit KYC ID card',
      description: 'Upload front and back images of Vietnamese ID card. On success, sets kyc_status=approved and fills identity fields.',
      consumes: ['multipart/form-data'],
    },
  }, handleMeKyc);

  app.get('/payment-methods', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'List own payment methods',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
  }, handleListMePaymentMethods);

  app.post<{ Body: CreatePaymentMethodInput }>('/payment-methods', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Add a payment method',
      body: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['BANK', 'CRYPTO'], description: 'BANK for VND payout, CRYPTO for an Avalanche C-Chain 0x wallet' },
          wallet_address: { type: 'string', description: 'Avalanche C-Chain (EVM) 0x wallet address (required for CRYPTO type)' },
          bank_id: { type: 'number', description: 'Bank BIN code (required for BANK type)' },
          full_name: { type: 'string', description: 'Account holder full name (required for BANK type)' },
          bank_account: { type: 'string', description: 'Bank account number (required for BANK type)' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, handleAddMePaymentMethod);

  app.patch<{ Params: { id: string }; Body: UpdatePaymentMethodInput }>('/payment-methods/:id', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Update a payment method',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          wallet_address: { type: 'string' },
          bank_id: { type: 'number' },
          full_name: { type: 'string' },
          bank_account: { type: 'string' },
        },
      },
    },
  }, handleUpdateMePaymentMethod);

  app.delete<{ Params: { id: string } }>('/payment-methods/:id', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Delete a payment method',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, handleDeleteMePaymentMethod);

  app.post<{ Body: MeDepositBody }>('/orders/deposit', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Create a deposit order (buy AVAX/USDT)',
      description: "Creates a buy order using the authenticated user's registered CRYPTO payment method.",
      body: {
        type: 'object',
        required: ['amount', 'chain_id', 'asset_code', 'payment_method_id'],
        properties: {
          amount: { type: 'string', description: 'Amount of crypto to buy' },
          chain_id: { type: 'integer', description: 'Avalanche C-Chain id (43113 Fuji, 43114 Mainnet)' },
          token_address: { type: 'string', description: 'C-Chain ERC-20 contract. Leave empty for native AVAX.' },
          asset_code: { type: 'string', description: 'Asset code: "AVAX" (native) or "USDT" (ERC-20)' },
          payment_method_id: { type: 'integer', description: 'ID of user CRYPTO payment method' },
          pay_gateway: { type: 'string', enum: ['bank', 'napas'], default: 'bank' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, handleMeDeposit);

  app.post<{ Body: MeWithdrawBody }>('/orders/withdraw', {
    preHandler: [userAuth, kycCheck],
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Create a withdrawal order (sell AVAX/USDT)',
      description: "Creates a sell order using the authenticated user's registered BANK payment method. Requires kyc_status=approved.",
      body: {
        type: 'object',
        required: ['amount', 'chain_id', 'asset_code', 'payment_method_id'],
        properties: {
          amount: { type: 'string', description: 'Amount of crypto to sell' },
          chain_id: { type: 'integer', description: 'Avalanche C-Chain id (43113 Fuji, 43114 Mainnet)' },
          token_address: { type: 'string', description: 'C-Chain ERC-20 contract. Leave empty for native AVAX.' },
          asset_code: { type: 'string', description: 'Asset code: "AVAX" (native) or "USDT" (ERC-20)' },
          payment_method_id: { type: 'integer', description: 'ID of user BANK payment method' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: {
          type: 'object',
          description: 'KYC not approved.',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                retriable: { type: 'boolean' },
                trace_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, handleMeWithdraw);

  app.get<{ Querystring: { limit?: string; offset?: string; direction?: string } }>('/orders', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'List own orders',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Max results (default 20, max 100)' },
          offset: { type: 'string', description: 'Offset for pagination (default 0)' },
          direction: { type: 'string', enum: ['buy', 'sell'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
  }, handleListMeOrders);

  app.get<{ Params: { id: string } }>('/orders/:id', {
    preHandler: userAuth,
    schema: {
      security: [{ BearerAuth: [] }],
      tags: ['Me'],
      summary: 'Get own order by ID or payment code',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Order ID (numeric) or payment code (e.g. DHA1B2C3D4)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, handleGetMeOrder);
}
