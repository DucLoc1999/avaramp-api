import type { FastifyRequest, FastifyReply } from 'fastify';

export async function sepayAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = process.env.SEPAY_WEBHOOK_API_KEY;
  if (!apiKey) {
    reply.status(401).send({ success: false, error: 'Unauthorized' });
    return;
  }

  const header = req.headers['authorization'];
  if (header !== `Apikey ${apiKey}`) {
    reply.status(401).send({ success: false, error: 'Unauthorized' });
  }
}
