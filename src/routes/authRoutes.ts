import type { FastifyInstance } from 'fastify';
import { handleGoogleLogin } from '../controllers/authController';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { id_token: string } }>('/google', {
    schema: {
      tags: ['Auth'],
      summary: 'Google OAuth login',
      description: 'Exchange a Google id_token for a service JWT. The id_token is obtained client-side via the Google Sign-In SDK.',
      body: {
        type: 'object',
        required: ['id_token'],
        properties: {
          id_token: { type: 'string', description: 'Google id_token from the client-side Google Sign-In SDK' },
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
                access_token: { type: 'string' },
                expires_in: { type: 'number' },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    email: { type: 'string' },
                    name: { type: 'string' },
                    kyc_status: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
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
  }, handleGoogleLogin);
}
