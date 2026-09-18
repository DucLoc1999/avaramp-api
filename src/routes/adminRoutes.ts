import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { handleGetStats, handleLogin, handleRotateCallbackSecret } from '../controllers/adminController';
import { adminAuth } from '../middlewares/adminAuth';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', {
    schema: {
      tags: ['Admin'],
      summary: 'Admin login (JWT)',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, handleLogin as (req: FastifyRequest, reply: FastifyReply) => Promise<void>);

  app.get('/stats', {
    preHandler: adminAuth,
    schema: {
      tags: ['Admin'],
      summary: 'Get order statistics (count, volume, fees)',
      description: 'Returns aggregated order stats by direction (buy/sell). Optional date range filters by payment_confirmed_at.',
      security: [{ BearerAuth: [] }],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', description: 'Start date (ISO 8601, e.g. "2026-01-01")' },
          to: { type: 'string', description: 'End date (ISO 8601, e.g. "2026-12-31")' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                from: { type: ['string', 'null'] },
                to: { type: ['string', 'null'] },
                totals: {
                  type: 'object',
                  properties: {
                    count: { type: 'number' },
                    net_vnd: { type: 'number' },
                    fee_vnd: { type: 'number' },
                    usdt_amount: { type: 'number' },
                  },
                },
                by_direction: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        400: {
          type: 'object',
          description: 'Invalid date format.',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, handleGetStats as (req: FastifyRequest, reply: FastifyReply) => Promise<void>);

  app.patch('/callback-secret', {
    preHandler: adminAuth,
    schema: {
      tags: ['Admin'],
      summary: 'Rotate callback HMAC signing secret',
      description: 'Updates the callback_secret_current. Previous secret stored as callback_secret_previous for dual-secret rotation window (5 min). New secret must be at least 32 characters.',
      security: [{ BearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['secret'],
        properties: {
          secret: { type: 'string', minLength: 32, description: 'New HMAC secret (min 32 characters)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                rotated_at: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          description: 'Secret too short or rotation already in progress.',
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
  }, handleRotateCallbackSecret as (req: FastifyRequest, reply: FastifyReply) => Promise<void>);
}

