import type { FastifyInstance } from 'fastify';
import { partnerAuth } from '../middlewares/partnerAuth';
import type { CreatePaymentMethodInput, UpdatePaymentMethodInput } from '../services/paymentMethodService';
import {
  handleGetUser,
  handleKycIdCard,
  handleListPayment,
  handleAddPayment,
  handleUpdatePayment,
  handleDeletePayment,
} from '../controllers/userController';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post('/kyc/id-card', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'KYC with CCCD (ID card)',
      description: 'Submit front and back images of Vietnamese ID card (CCCD) as multipart/form-data. Extracts identity data and creates a user record.',
      consumes: ['multipart/form-data'],
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
  }, handleKycIdCard);

  app.get<{ Params: { identifier: string }; Querystring: { type?: string } }>('/:identifier', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'Get user info',
      description: 'Retrieve user by id, phone, email, or CCCD number. Use query param `type` to specify lookup field.',
      params: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'The value to search by' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['id', 'phone', 'email', 'cccd'], description: 'Lookup field type (default: id)' },
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
  }, handleGetUser);

  app.get<{ Params: { user_id: string } }>('/:user_id/payment', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'List payment methods',
      description: 'List all payment methods for a user.',
      params: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
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
  }, handleListPayment);

  app.post<{ Params: { user_id: string }; Body: CreatePaymentMethodInput }>('/:user_id/payment', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'Add payment method',
      description: 'Add a new payment method (BANK or CRYPTO) for a user.',
      params: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
        },
      },
      body: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['BANK', 'CRYPTO'], description: 'Payment type' },
          wallet_address: { type: 'string', description: 'Crypto wallet address (required if type=CRYPTO)' },
          bank_id: { type: 'integer', description: 'Bank BIN code (required if type=BANK)' },
          full_name: { type: 'string', description: 'Account holder name (required if type=BANK)' },
          bank_account: { type: 'string', description: 'Bank account number (required if type=BANK)' },
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
  }, handleAddPayment);

  app.patch<{ Params: { user_id: string; payment_id: string }; Body: UpdatePaymentMethodInput }>('/:user_id/payment/:payment_id', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'Update payment method',
      description: 'Update an existing payment method.',
      params: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          payment_id: { type: 'string', description: 'Payment method ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          wallet_address: { type: 'string' },
          bank_id: { type: 'integer' },
          full_name: { type: 'string' },
          bank_account: { type: 'string' },
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
  }, handleUpdatePayment);

  app.delete<{ Params: { user_id: string; payment_id: string } }>('/:user_id/payment/:payment_id', {
    preHandler: partnerAuth,
    schema: {
      security: [{ PartnerAppKey: [] }],
      tags: ['Users'],
      summary: 'Delete payment method',
      description: 'Delete a payment method.',
      params: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'User ID' },
          payment_id: { type: 'string', description: 'Payment method ID' },
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
  }, handleDeletePayment);
}
