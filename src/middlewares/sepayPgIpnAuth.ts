import type { FastifyRequest, FastifyReply } from 'fastify';

const SECRET_KEY = process.env.SEPAY_PG_IPN_SECRET_KEY || '';

export async function sepayPgIpnAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!SECRET_KEY) return;

  const provided = req.headers['x-secret-key'];
  if (provided !== SECRET_KEY) {
    reply.code(401).send({ success: false, error: 'Unauthorized' });
  }
}
